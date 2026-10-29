import type { Env } from "./env.ts";
import { API_VERSION, PROVIDERS, SUPPORTED_MODULES, validateCreatePairingChallenge, validateClaimPairing } from "../packages/contracts/src/v1.ts";
import type { ProviderHealthSnapshot } from "../packages/contracts/src/chat-v1.ts";
import { aggregateViewerCounts, emptyProviderHealth, normalizeKickChatMessage, normalizeTwitchChatMessage } from "../packages/shared/src/chat.ts";
import { persistNormalizedChatMessage } from "../packages/shared/src/chat-persistence.ts";
import { extractKickPublicKey, verifyKickWebhookSignature } from "../packages/shared/src/kick-webhook.ts";
import { verifyTwitchEventSubSignature } from "../packages/shared/src/twitch-eventsub.ts";
import { createOAuthState, digestOAuthState } from "../packages/shared/src/oauth-state.ts";
import { disconnectProvider, ensureFreshTwitchProviderTokens, persistProviderTokens } from "../packages/shared/src/provider-connections.ts";
import { claimPairingChallenge, createPairingChallenge } from "../packages/shared/src/pairing.ts";
import { createAuth } from "./auth.ts";
export { ChatRoom } from "./chat-room.ts";

const VERSION = "0.1.0-dev";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

let kickPublicKeyCache: { value: string; expiresAt: number } | null = null;

async function loadKickPublicKey(): Promise<string | null> {
  if (kickPublicKeyCache && kickPublicKeyCache.expiresAt > Date.now()) return kickPublicKeyCache.value;
  try {
    const response = await fetch("https://api.kick.com/public/v1/public-key", {
      headers: { accept: "application/json, text/plain" },
    });
    if (!response.ok) return null;
    const key = extractKickPublicKey(await response.text());
    if (!key) return null;
    kickPublicKeyCache = { value: key, expiresAt: Date.now() + 15 * 60 * 1000 };
    return key;
  } catch {
    return null;
  }
}

function jsonError(status: number, code: string, message: string, requestId?: string): Response {
  return Response.json({ error: { code, message, ...(requestId ? { requestId } : {}) } }, {
    status, headers: JSON_HEADERS,
  });
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) throw new Error("body_too_large");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 4096) throw new Error("body_too_large");
  try { return JSON.parse(raw) as unknown; } catch { throw new Error("invalid_json"); }
}

type AuthContext = { ok: true; userId: string; auth: any } |
  { ok: false; status: 401 | 503; code: string; message: string };

async function getAuthContext(request: Request, env: Env): Promise<AuthContext> {
  const auth = createAuth(env);
  if (!auth) return { ok: false, status: 503, code: "auth_not_configured", message: "Local authentication is not configured." };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return { ok: false, status: 401, code: "authentication_required", message: "Sign in to RiftPulse to continue." };
  return { ok: true, userId: session.user.id, auth };
}

async function publishChatMessage(env: Env, accountId: string, message: {
  id: string; provider: "twitch" | "youtube" | "kick" | "tiktok"; externalMessageId: string;
  channelId: string; channelName: string; senderId: string; senderName: string; text: string;
  sentAt: string; receivedAt: string; badges: { moderator: boolean; subscriber: boolean; verified: boolean };
}): Promise<void> {
  if (!env.CHAT_ROOM) return;
  try {
    const roomId = env.CHAT_ROOM.idFromName(accountId);
    const room = env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request("https://chat-room/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chat.message", message }),
    }));
  } catch {
    // Chat history remains durable; realtime delivery is best-effort.
  }
}

function isTrustedMutationOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configured = (env.TRUSTED_ORIGINS ?? env.APP_BASE_URL ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const allowed = configured.flatMap(value => {
    try { return [new URL(value).origin]; } catch { return []; }
  });
  return allowed.includes(origin);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim() || null;
  }
  return null;
}

function twitchStateCookie(state: string | null, secure: boolean): string {
  const base = "rp_twitch_oauth_state=" + (state ?? "") + "; Path=/api/v1/providers/twitch/callback; HttpOnly; SameSite=Lax; Max-Age=" + (state ? "600" : "0");
  return secure ? base + "; Secure" : base;
}

function providerRedirect(env: Env, status: string): Response {
  let target: URL;
  try { target = new URL(env.APP_BASE_URL ?? "http://127.0.0.1:5173"); }
  catch { target = new URL("http://127.0.0.1:5173"); }
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  target.searchParams.set("provider", "twitch");
  target.searchParams.set("status", status);
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    if (url.pathname.startsWith("/api/auth/")) {
      const auth = createAuth(env);
      if (!auth) return jsonError(503, "auth_not_configured", "Local authentication is not configured. Use the local development origin and set the required secrets.", requestId);
      return auth.handler(request);
    }

    if (url.pathname === "/api/v1/health" && request.method === "GET") {
      return Response.json({
        service: "riftpulse-api", status: "ok", version: VERSION, apiVersion: API_VERSION,
      }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/version" && request.method === "GET") {
      return Response.json({
        service: "riftpulse-api", version: VERSION, apiVersion: API_VERSION, modules: SUPPORTED_MODULES,
      }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/settings/modules" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const now = new Date().toISOString();
      const defaults = await env.DB.batch(SUPPORTED_MODULES.map(moduleKey => env.DB!.prepare(
        "INSERT OR IGNORE INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, 1, '{}', ?)",
      ).bind(crypto.randomUUID(), authContext.userId, moduleKey, now)));
      if (defaults.some(result => !result.success)) return jsonError(503, "settings_store_unavailable", "Could not initialize module settings.", requestId);
      const rows = await env.DB.prepare(
        "SELECT module_key, enabled, settings_json, updated_at FROM module_settings WHERE account_id = ?",
      ).bind(authContext.userId).all<{ module_key: string; enabled: number; settings_json: string; updated_at: string }>();
      if (!rows.success) return jsonError(503, "settings_store_unavailable", "Could not load module settings.", requestId);
      const modules: Record<string, { enabled: boolean; settings: unknown; updatedAt: string | null }> = {};
      for (const moduleKey of SUPPORTED_MODULES) modules[moduleKey] = { enabled: true, settings: {}, updatedAt: null };
      for (const row of rows.results ?? []) {
        if (!SUPPORTED_MODULES.includes(row.module_key as typeof SUPPORTED_MODULES[number])) continue;
        let settings: unknown = {};
        try { settings = JSON.parse(row.settings_json); } catch { settings = {}; }
        modules[row.module_key] = { enabled: row.enabled === 1, settings, updatedAt: row.updated_at };
      }
      return Response.json({ modules }, { headers: JSON_HEADERS });
    }

    const moduleSettingsMatch = url.pathname.match(/^\/api\/v1\/settings\/modules\/(chat|bsr-song-request)$/);
    if (moduleSettingsMatch && request.method === "PATCH") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      if (!isJson(request)) return jsonError(415, "content_type_required", "Send a JSON request body.", requestId);
      let body: unknown;
      try { body = await readJson(request); }
      catch (error) {
        const message = error instanceof Error ? error.message : "invalid_json";
        return message === "body_too_large"
          ? jsonError(413, "body_too_large", "Request body exceeds 4 KiB.", requestId)
          : jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "validation_failed", "Settings body must be an object.", requestId);
      const value = body as Record<string, unknown>;
      if (Object.keys(value).some(key => key !== "enabled" && key !== "settings")) return jsonError(400, "validation_failed", "Only enabled and settings can be changed.", requestId);
      if (value.enabled !== undefined && typeof value.enabled !== "boolean") return jsonError(400, "validation_failed", "enabled must be a boolean.", requestId);
      if (value.settings !== undefined && (!value.settings || typeof value.settings !== "object" || Array.isArray(value.settings))) {
        return jsonError(400, "validation_failed", "settings must be a JSON object.", requestId);
      }
      const settingsJson = value.settings === undefined ? undefined : JSON.stringify(value.settings);
      if (settingsJson && settingsJson.length > 3072) return jsonError(413, "settings_too_large", "Settings JSON exceeds 3 KiB.", requestId);
      const moduleKey = moduleSettingsMatch[1];
      const now = new Date().toISOString();
      const inserted = await env.DB.prepare(
        "INSERT OR IGNORE INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, 1, '{}', ?)",
      ).bind(crypto.randomUUID(), authContext.userId, moduleKey, now).run();
      if (!inserted.success) return jsonError(503, "settings_store_unavailable", "Could not initialize module settings.", requestId);
      const current = await env.DB.prepare(
        "SELECT enabled, settings_json FROM module_settings WHERE account_id = ? AND module_key = ? LIMIT 1",
      ).bind(authContext.userId, moduleKey).first<{ enabled: number; settings_json: string }>();
      if (!current) return jsonError(503, "settings_store_unavailable", "Could not load module settings.", requestId);
      const enabled = value.enabled === undefined ? current.enabled : value.enabled ? 1 : 0;
      const nextSettings = settingsJson ?? current.settings_json;
      const updated = await env.DB.prepare(
        "UPDATE module_settings SET enabled = ?, settings_json = ?, updated_at = ? WHERE account_id = ? AND module_key = ?",
      ).bind(enabled, nextSettings, now, authContext.userId, moduleKey).run();
      if (!updated.success) return jsonError(503, "settings_store_unavailable", "Could not save module settings.", requestId);
      let settings: unknown = {};
      try { settings = JSON.parse(nextSettings); } catch { settings = {}; }
      return Response.json({ moduleKey, enabled: enabled === 1, settings, updatedAt: now }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/providers/connections" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      const result = await env.DB.prepare(
        "SELECT pc.provider, pc.display_name AS displayName, pc.status, pc.connected_at AS connectedAt, ih.status AS healthStatus, ih.detail_code AS healthDetailCode FROM provider_connections pc LEFT JOIN integration_health ih ON ih.account_id = pc.account_id AND ih.provider = pc.provider WHERE pc.account_id = ?",
      ).bind(authContext.userId).all<{ provider: string; displayName: string | null; status: string; connectedAt: string | null; healthStatus: string | null; healthDetailCode: string | null }>();
      if (!result.success) return jsonError(503, "provider_store_unavailable", "Could not load provider connections.", requestId);
      const rows = new Map((result.results ?? []).map(row => [row.provider, row]));
      const configured = !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY && env.APP_BASE_URL);
      const connections = PROVIDERS.map(provider => {
        const row = rows.get(provider);
        return {
          provider,
          status: provider === "tiktok" ? "unsupported" : row?.status ?? "disconnected",
          displayName: row?.displayName ?? null,
          connectedAt: row?.connectedAt ?? null,
          configured: provider === "twitch" ? configured : false,
          detailCode: provider === "tiktok" ? "unofficial_connector_unavailable"
            : provider === "twitch" && !configured ? "oauth_credentials_not_configured"
            : provider === "twitch" && row?.status === "connected" && row.healthStatus !== "healthy" ? row?.healthDetailCode ?? "eventsub_subscription_pending"
            : row?.healthDetailCode ?? null,
        };
      });
      return Response.json({ connections }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/providers/twitch/connect" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) {
        return jsonError(503, "twitch_oauth_not_configured", "Twitch OAuth credentials, app URL, and token encryption key must be configured locally first.", requestId);
      }
      let appUrl: URL, redirectUri: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.TWITCH_REDIRECT_URI ?? "/api/v1/providers/twitch/callback", appUrl);
      } catch {
        return jsonError(503, "twitch_oauth_not_configured", "The Twitch OAuth callback URL is invalid.", requestId);
      }
      if (redirectUri.origin !== appUrl.origin || redirectUri.pathname !== "/api/v1/providers/twitch/callback"
        || redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash
        || (redirectUri.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(redirectUri.hostname))) {
        return jsonError(503, "twitch_oauth_not_configured", "The callback must be the exact same-origin registered Twitch callback URL.", requestId);
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
      const cleanup = await env.DB.prepare(
        "DELETE FROM provider_oauth_states WHERE expires_at <= ? OR (account_id = ? AND provider = 'twitch' AND consumed_at IS NULL)",
      ).bind(nowIso, authContext.userId).run();
      if (!cleanup.success) return jsonError(503, "oauth_state_store_unavailable", "Could not prepare a secure authorization attempt.", requestId);
      const state = createOAuthState();
      const digest = await digestOAuthState(state);
      const inserted = await env.DB.prepare(
        "INSERT INTO provider_oauth_states (state_digest, account_id, provider, created_at, expires_at, consumed_at) VALUES (?, ?, 'twitch', ?, ?, NULL)",
      ).bind(digest, authContext.userId, nowIso, expiresAt).run();
      if (!inserted.success) return jsonError(503, "oauth_state_store_unavailable", "Could not start a secure authorization attempt.", requestId);

      const authorizationUrl = new URL("https://id.twitch.tv/oauth2/authorize");
      authorizationUrl.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", "user:read:chat user:bot channel:bot");
      authorizationUrl.searchParams.set("state", state);
      return Response.json({ authorizationUrl: authorizationUrl.toString() }, {
        headers: { ...JSON_HEADERS, "set-cookie": twitchStateCookie(state, redirectUri.protocol === "https:") },
      });
    }

    if (url.pathname === "/api/v1/providers/twitch/callback" && request.method === "GET") {
      const state = url.searchParams.get("state");
      const cookieState = readCookie(request, "rp_twitch_oauth_state");
      const secureCookie = url.protocol === "https:";
      const finish = (status: string) => {
        const response = providerRedirect(env, status);
        response.headers.append("set-cookie", twitchStateCookie(null, secureCookie));
        response.headers.set("cache-control", "no-store");
        response.headers.set("referrer-policy", "no-referrer");
        return response;
      };
      if (!env.DB || !env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL
        || !state || state !== cookieState || !/^[a-f0-9]{64}$/i.test(state)) return finish("failed");
      const digest = await digestOAuthState(state);
      const now = new Date();
      const claimedState = await env.DB.prepare(
        "UPDATE provider_oauth_states SET consumed_at = ? WHERE state_digest = ? AND provider = 'twitch' AND consumed_at IS NULL AND expires_at > ? RETURNING account_id",
      ).bind(now.toISOString(), digest, now.toISOString()).first<{ account_id: string }>();
      if (!claimedState?.account_id) return finish("failed");
      if (url.searchParams.has("error")) return finish("denied");
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048) return finish("failed");

      let appUrl: URL, redirectUri: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.TWITCH_REDIRECT_URI ?? "/api/v1/providers/twitch/callback", appUrl);
      } catch { return finish("failed"); }
      if (redirectUri.origin !== appUrl.origin || redirectUri.pathname !== "/api/v1/providers/twitch/callback") return finish("failed");

      try {
        const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri.toString(),
          }),
        });
        if (!tokenResponse.ok) return finish("failed");
        const tokenPayload: unknown = await tokenResponse.json();
        if (!tokenPayload || typeof tokenPayload !== "object" || Array.isArray(tokenPayload)) return finish("failed");
        const token = tokenPayload as Record<string, unknown>;
        if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string"
          || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) return finish("failed");

        const validateResponse = await fetch("https://id.twitch.tv/oauth2/validate", {
          headers: { authorization: "OAuth " + token.access_token, accept: "application/json" },
        });
        if (!validateResponse.ok) return finish("failed");
        const validationPayload: unknown = await validateResponse.json();
        if (!validationPayload || typeof validationPayload !== "object" || Array.isArray(validationPayload)) return finish("failed");
        const validation = validationPayload as Record<string, unknown>;
        const validationScopes = Array.isArray(validation.scopes) && validation.scopes.every(scope => typeof scope === "string")
          ? validation.scopes as string[] : null;
        const requiredScopes = ["user:read:chat", "user:bot", "channel:bot"];
        if (validation.client_id !== env.TWITCH_CLIENT_ID || typeof validation.user_id !== "string"
          || !validation.user_id || typeof validation.login !== "string" || !validation.login
          || !validationScopes || !requiredScopes.every(scope => validationScopes.includes(scope))) return finish("failed");

        const saved = await persistProviderTokens(env.DB, {
          accountId: claimedState.account_id, provider: "twitch", externalAccountId: validation.user_id,
          displayName: validation.login, accessToken: token.access_token, refreshToken: token.refresh_token,
          tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
          scopes: validationScopes,
        }, env.TOKEN_ENCRYPTION_KEY);
        if (!saved.ok) return finish("failed");

        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'degraded', NULL, ?, 'eventsub_subscription_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'eventsub_subscription_pending', viewer_count_observed_at = NULL",
        ).bind(crypto.randomUUID(), claimedState.account_id, new Date().toISOString()).run();
        if (!health.success) return finish("failed");
        return finish("connected");
      } catch {
        return finish("failed");
      }
    }

    if (url.pathname === "/api/v1/providers/twitch/eventsub/subscribe" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET || !env.TWITCH_EVENTSUB_SECRET
        || env.TWITCH_EVENTSUB_SECRET.length < 10 || env.TWITCH_EVENTSUB_SECRET.length > 100 || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) {
        return jsonError(503, "twitch_eventsub_not_configured", "Twitch app credentials, EventSub secret, token key, and app URL must be configured.", requestId);
      }

      let appUrl: URL;
      let callbackUrl: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        callbackUrl = new URL("/api/v1/providers/twitch/webhook", appUrl);
      } catch {
        return jsonError(503, "twitch_eventsub_not_configured", "The Twitch webhook URL is invalid.", requestId);
      }
      if (callbackUrl.protocol !== "https:" || callbackUrl.origin !== appUrl.origin || callbackUrl.username || callbackUrl.password) {
        return jsonError(503, "twitch_eventsub_requires_https", "Twitch webhook subscriptions require a public HTTPS callback on port 443.", requestId);
      }

      const connection = await env.DB.prepare(
        "SELECT external_account_id AS externalAccountId FROM provider_connections WHERE account_id = ? AND provider = 'twitch' AND status = 'connected' LIMIT 1",
      ).bind(authContext.userId).first<{ externalAccountId: string | null }>();
      if (!connection?.externalAccountId) return jsonError(409, "twitch_not_connected", "Connect a Twitch account before enabling chat events.", requestId);

      const stored = await ensureFreshTwitchProviderTokens(
        env.DB, authContext.userId, env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET, env.TOKEN_ENCRYPTION_KEY,
      );
      if (!stored.ok) return jsonError(409, "twitch_token_unavailable", "Reconnect Twitch and grant the required chat permissions.", requestId);
      if (stored.externalAccountId !== connection.externalAccountId) {
        return jsonError(409, "twitch_account_mismatch", "Reconnect the intended Twitch account before enabling chat events.", requestId);
      }
      try {
        const appTokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            grant_type: "client_credentials",
          }),
        });
        if (!appTokenResponse.ok) return jsonError(502, "twitch_app_token_failed", "Could not obtain the Twitch application token.", requestId);
        const appTokenPayload: unknown = await appTokenResponse.json();
        if (!appTokenPayload || typeof appTokenPayload !== "object" || Array.isArray(appTokenPayload)) {
          return jsonError(502, "twitch_app_token_failed", "Twitch returned an invalid application token response.", requestId);
        }
        const appToken = (appTokenPayload as Record<string, unknown>).access_token;
        if (typeof appToken !== "string" || !appToken) return jsonError(502, "twitch_app_token_failed", "Twitch returned an invalid application token response.", requestId);

        const listUrl = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
        listUrl.searchParams.set("type", "channel.chat.message");

        listUrl.searchParams.set("first", "100");
        const existingResponse = await fetch(listUrl, {
          headers: { "Client-Id": env.TWITCH_CLIENT_ID, authorization: "Bearer " + appToken, accept: "application/json" },
        });
        if (!existingResponse.ok) return jsonError(502, "twitch_eventsub_lookup_failed", "Could not check existing Twitch chat subscriptions.", requestId);
        const existingPayload: unknown = await existingResponse.json();
        const existingData = typeof existingPayload === "object" && existingPayload !== null && !Array.isArray(existingPayload)
          ? (existingPayload as Record<string, unknown>).data : null;
        const existing = Array.isArray(existingData) ? existingData.find(item => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const sub = item as Record<string, unknown>;
          const condition = typeof sub.condition === "object" && sub.condition !== null ? sub.condition as Record<string, unknown> : {};
          const transport = typeof sub.transport === "object" && sub.transport !== null ? sub.transport as Record<string, unknown> : {};
          return sub.type === "channel.chat.message" && (sub.status === "enabled" || sub.status === "webhook_callback_verification_pending")
            && condition.broadcaster_user_id === connection.externalAccountId
            && condition.user_id === connection.externalAccountId
            && transport.method === "webhook" && transport.callback === callbackUrl.toString();
        }) : null;

        if (!existing) {
          const createResponse = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
            method: "POST",
            headers: {
              "Client-Id": env.TWITCH_CLIENT_ID,
              authorization: "Bearer " + appToken,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              type: "channel.chat.message",
              version: "1",
              condition: { broadcaster_user_id: connection.externalAccountId, user_id: connection.externalAccountId },
              transport: { method: "webhook", callback: callbackUrl.toString(), secret: env.TWITCH_EVENTSUB_SECRET },
            }),
          });
          if (!createResponse.ok) {
            await env.DB.prepare(
              "UPDATE integration_health SET status = 'degraded', observed_at = ?, detail_code = 'eventsub_subscription_failed' WHERE account_id = ? AND provider = 'twitch'",
            ).bind(new Date().toISOString(), authContext.userId).run();
            return jsonError(502, "twitch_eventsub_subscription_failed", "Twitch did not accept the chat subscription. Check the requested scopes and callback configuration.", requestId);
          }
        }

        const now = new Date().toISOString();
        if (existing && typeof existing === "object" && !Array.isArray(existing) && (existing as Record<string, unknown>).status === "enabled") {
          const health = await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = NULL, viewer_count_observed_at = NULL",
          ).bind(crypto.randomUUID(), authContext.userId, now).run();
          if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch chat setup status.", requestId);
          return Response.json({ status: "subscribed", alreadyEnabled: true }, { headers: JSON_HEADERS });
        }
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'degraded', NULL, ?, 'eventsub_verification_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'eventsub_verification_pending', viewer_count_observed_at = NULL",
        ).bind(crypto.randomUUID(), authContext.userId, now).run();
        if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch chat setup status.", requestId);
        return Response.json({ status: "verification_pending", alreadyEnabled: false }, { headers: JSON_HEADERS });
      } catch {
        return jsonError(502, "twitch_eventsub_setup_failed", "Could not complete Twitch chat setup.", requestId);
      }
    }

    const disconnectProviderMatch = url.pathname.match(/^\/api\/v1\/providers\/(twitch|youtube|kick|tiktok)$/);
    if (disconnectProviderMatch && request.method === "DELETE") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      const provider = disconnectProviderMatch[1] as typeof PROVIDERS[number];
      if (provider === "tiktok") return jsonError(409, "provider_unsupported", "TikTok LIVE is not available in this build.", requestId);
      if (!await disconnectProvider(env.DB, authContext.userId, provider)) return jsonError(503, "provider_store_unavailable", "Could not disconnect provider.", requestId);
      const health = await env.DB.prepare(
        "UPDATE integration_health SET status = 'disconnected', viewer_count = NULL, viewer_count_observed_at = NULL, observed_at = ?, detail_code = 'user_disconnected' WHERE account_id = ? AND provider = ?",
      ).bind(new Date().toISOString(), authContext.userId, provider).run();
      if (!health.success) return jsonError(503, "provider_health_update_failed", "Provider was disconnected but health status could not be updated.", requestId);
      return Response.json({ status: "disconnected", provider }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/providers/twitch/webhook" && request.method === "POST") {
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      if (!env.TWITCH_EVENTSUB_SECRET || env.TWITCH_EVENTSUB_SECRET.length < 10 || env.TWITCH_EVENTSUB_SECRET.length > 100) {
        return jsonError(503, "twitch_webhook_not_configured", "Twitch EventSub webhook verification is not configured.", requestId);
      }
      const declaredLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
        return jsonError(413, "body_too_large", "Webhook body exceeds 64 KiB.", requestId);
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 65_536) {
        return jsonError(413, "body_too_large", "Webhook body exceeds 64 KiB.", requestId);
      }
      const messageId = request.headers.get("Twitch-Eventsub-Message-Id");
      const timestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp");
      const signature = request.headers.get("Twitch-Eventsub-Message-Signature");
      const messageType = request.headers.get("Twitch-Eventsub-Message-Type");
      if (!messageId || !timestamp || !signature || !messageType) {
        return jsonError(400, "webhook_headers_missing", "Required Twitch EventSub headers are missing.", requestId);
      }
      const validSignature = await verifyTwitchEventSubSignature(
        { messageId, timestamp, signature, rawBody }, env.TWITCH_EVENTSUB_SECRET,
      );
      if (!validSignature) return jsonError(401, "invalid_webhook_signature", "Twitch EventSub signature or timestamp is invalid.", requestId);

      let payload: unknown;
      try { payload = JSON.parse(rawBody) as unknown; }
      catch { return jsonError(400, "invalid_webhook_json", "Webhook body is not valid JSON.", requestId); }
      const root = typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? payload as Record<string, unknown> : null;
      if (!root) return jsonError(400, "invalid_webhook_json", "Webhook body must be a JSON object.", requestId);

      if (messageType === "webhook_callback_verification") {
        const challenge = typeof root.challenge === "string" ? root.challenge : "";
        if (!challenge || challenge.length > 512) return jsonError(400, "invalid_challenge", "Twitch challenge is invalid.", requestId);
        const subscription = typeof root.subscription === "object" && root.subscription !== null && !Array.isArray(root.subscription)
          ? root.subscription as Record<string, unknown> : {};
        const condition = typeof subscription.condition === "object" && subscription.condition !== null && !Array.isArray(subscription.condition)
          ? subscription.condition as Record<string, unknown> : {};
        const broadcasterId = typeof condition.broadcaster_user_id === "string" ? condition.broadcaster_user_id : "";
        if (subscription.type === "channel.chat.message" && subscription.version === "1" && broadcasterId) {
          const connections = await env.DB.prepare(
            "SELECT account_id FROM provider_connections WHERE provider = 'twitch' AND external_account_id = ? AND status = 'connected'",
          ).bind(broadcasterId).all<{ account_id: string }>();
          if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not confirm Twitch webhook setup.", requestId);
          const now = new Date().toISOString();
          for (const connection of connections.results ?? []) {
            const health = await env.DB.prepare(
              "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = NULL, viewer_count_observed_at = NULL",
            ).bind(crypto.randomUUID(), connection.account_id, now).run();
            if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not confirm Twitch webhook setup.", requestId);
          }
        }
        return new Response(challenge, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      }

      if (messageType === "revocation") {
        const subscription = typeof root.subscription === "object" && root.subscription !== null
          ? root.subscription as Record<string, unknown> : {};
        const condition = typeof subscription.condition === "object" && subscription.condition !== null
          ? subscription.condition as Record<string, unknown> : {};
        const broadcasterId = typeof condition.broadcaster_user_id === "string" ? condition.broadcaster_user_id : "";
        if (!broadcasterId) return Response.json({ status: "ignored", reason: "missing_broadcaster" }, { status: 202, headers: JSON_HEADERS });
        const now = new Date().toISOString();
        const connections = await env.DB.prepare(
          "SELECT account_id FROM provider_connections WHERE provider = 'twitch' AND external_account_id = ?",
        ).bind(broadcasterId).all<{ account_id: string }>();
        if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not route Twitch revocation.", requestId);
        for (const connection of connections.results ?? []) {
          const updatedConnection = await env.DB.prepare(
            "UPDATE provider_connections SET status = 'degraded', updated_at = ? WHERE account_id = ? AND provider = 'twitch'",
          ).bind(now, connection.account_id).run();
          if (!updatedConnection.success) return jsonError(503, "provider_connection_update_failed", "Could not update Twitch connection health.", requestId);
          const updatedHealth = await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'degraded', NULL, ?, 'eventsub_revoked', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', observed_at = excluded.observed_at, detail_code = 'eventsub_revoked'",
          ).bind(crypto.randomUUID(), connection.account_id, now).run();
          if (!updatedHealth.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch provider health.", requestId);
        }
        return Response.json({ status: "revocation_recorded" }, { headers: JSON_HEADERS });
      }

      if (messageType !== "notification") {
        return Response.json({ status: "ignored", reason: "unsupported_message_type" }, { status: 202, headers: JSON_HEADERS });
      }
      const subscription = typeof root.subscription === "object" && root.subscription !== null
        ? root.subscription as Record<string, unknown> : {};
      if (subscription.type !== "channel.chat.message" || subscription.version !== "1") {
        return Response.json({ status: "ignored", reason: "unsupported_event" }, { status: 202, headers: JSON_HEADERS });
      }
      const message = normalizeTwitchChatMessage(payload);
      if (!message) return jsonError(400, "invalid_chat_event", "Twitch chat event is missing required message fields.", requestId);
      const connections = await env.DB.prepare(
        "SELECT account_id FROM provider_connections WHERE provider = 'twitch' AND external_account_id = ? AND status = 'connected'",
      ).bind(message.channelId).all<{ account_id: string }>();
      if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not route the Twitch event.", requestId);
      if (!connections.results?.length) {
        return Response.json({ status: "ignored", reason: "channel_not_connected" }, { status: 202, headers: JSON_HEADERS });
      }
      let insertedMessages = 0;
      const now = new Date().toISOString();
      for (const connection of connections.results) {
        const persisted = await persistNormalizedChatMessage(env.DB, connection.account_id, message);
        if (!persisted.ok) return jsonError(503, "chat_store_unavailable", "Could not store the Twitch chat event.", requestId);
        if (persisted.inserted) {
          insertedMessages++;
          await publishChatMessage(env, connection.account_id, message);
        }
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', observed_at = excluded.observed_at, detail_code = NULL",
        ).bind(crypto.randomUUID(), connection.account_id, now).run();
        if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch provider health.", requestId);
      }
      return Response.json({
        status: insertedMessages > 0 ? "accepted" : "duplicate",
        deliveredAccounts: connections.results.length,
        insertedMessages,
      }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/realtime" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "WebSocket origin is not trusted.", requestId);
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonError(426, "websocket_upgrade_required", "Use a WebSocket connection.", requestId);
      }
      if (!env.CHAT_ROOM) return jsonError(503, "realtime_unavailable", "Realtime chat is not configured.", requestId);
      const roomId = env.CHAT_ROOM.idFromName(authContext.userId);
      return env.CHAT_ROOM.get(roomId).fetch(new Request("https://chat-room/connect", request));
    }

    if (url.pathname === "/api/v1/providers/kick/webhook" && request.method === "POST") {
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const declaredLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > 65_536) {
        return jsonError(413, "body_too_large", "Webhook body exceeds 64 KiB.", requestId);
      }
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 65_536) {
        return jsonError(413, "body_too_large", "Webhook body exceeds 64 KiB.", requestId);
      }

      const messageId = request.headers.get("Kick-Event-Message-Id");
      const timestamp = request.headers.get("Kick-Event-Message-Timestamp");
      const signature = request.headers.get("Kick-Event-Signature");
      const eventType = request.headers.get("Kick-Event-Type");
      const eventVersion = request.headers.get("Kick-Event-Version");
      if (!messageId || !timestamp || !signature || !eventType || !eventVersion) {
        return jsonError(400, "webhook_headers_missing", "Required Kick webhook headers are missing.", requestId);
      }
      const publicKey = await loadKickPublicKey();
      if (!publicKey) return jsonError(503, "kick_public_key_unavailable", "Could not validate the current Kick webhook key.", requestId);
      const validSignature = await verifyKickWebhookSignature(
        { messageId, timestamp, signature, rawBody }, publicKey,
      );
      if (!validSignature) return jsonError(401, "invalid_webhook_signature", "Kick webhook signature or timestamp is invalid.", requestId);
      if (eventType !== "chat.message.sent" || eventVersion !== "1") {
        return Response.json({ status: "ignored", reason: "unsupported_event" }, { status: 202, headers: JSON_HEADERS });
      }

      let payload: unknown;
      try { payload = JSON.parse(rawBody) as unknown; }
      catch { return jsonError(400, "invalid_webhook_json", "Webhook body is not valid JSON.", requestId); }
      const message = normalizeKickChatMessage(payload);
      if (!message) return jsonError(400, "invalid_chat_event", "Kick chat event is missing required message fields.", requestId);

      const connections = await env.DB.prepare(
        "SELECT account_id FROM provider_connections WHERE provider = 'kick' AND external_account_id = ? AND status = 'connected'",
      ).bind(message.channelId).all<{ account_id: string }>();
      if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not route the Kick event.", requestId);
      if (!connections.results?.length) {
        return Response.json({ status: "ignored", reason: "channel_not_connected" }, { status: 202, headers: JSON_HEADERS });
      }

      let insertedMessages = 0;
      const now = new Date().toISOString();
      for (const connection of connections.results) {
        const persisted = await persistNormalizedChatMessage(env.DB, connection.account_id, message);
        if (!persisted.ok) return jsonError(503, "chat_store_unavailable", "Could not store the Kick chat event.", requestId);
        if (persisted.inserted) {
          insertedMessages++;
          await publishChatMessage(env, connection.account_id, message);
        }
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'kick', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', observed_at = excluded.observed_at, detail_code = NULL",
        ).bind(crypto.randomUUID(), connection.account_id, now).run();
        if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Kick provider health.", requestId);
      }
      return Response.json({
        status: insertedMessages > 0 ? "accepted" : "duplicate",
        deliveredAccounts: connections.results.length,
        insertedMessages,
      }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/chat/messages" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const result = await env.DB.prepare(
        "SELECT id, provider, external_message_id AS externalMessageId, channel_id AS channelId, channel_name AS channelName, sender_id AS senderId, sender_name AS senderName, text, sent_at AS sentAt, received_at AS receivedAt, badges_json AS badgesJson FROM chat_messages WHERE account_id = ? ORDER BY received_at DESC LIMIT 100",
      ).bind(authContext.userId).all<{
        id: string; provider: string; externalMessageId: string; channelId: string; channelName: string;
        senderId: string; senderName: string; text: string; sentAt: string; receivedAt: string; badgesJson: string;
      }>();
      if (!result.success) return jsonError(503, "chat_store_unavailable", "Could not load chat messages.", requestId);
      const messages = (result.results ?? []).map(row => {
        let parsed: unknown = {};
        try { parsed = JSON.parse(row.badgesJson); } catch { parsed = {}; }
        const flags = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        return {
          id: row.id, provider: row.provider, externalMessageId: row.externalMessageId,
          channelId: row.channelId, channelName: row.channelName, senderId: row.senderId,
          senderName: row.senderName, text: row.text, sentAt: row.sentAt, receivedAt: row.receivedAt,
          badges: { moderator: flags.moderator === true, subscriber: flags.subscriber === true, verified: flags.verified === true },
        };
      }).reverse();
      return Response.json({ messages }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/integrations/health" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const result = await env.DB.prepare(
        "SELECT provider, status, viewer_count AS viewerCount, observed_at AS observedAt, viewer_count_observed_at AS viewerCountObservedAt, detail_code AS detailCode, (SELECT MAX(received_at) FROM chat_messages cm WHERE cm.account_id = integration_health.account_id AND cm.provider = integration_health.provider) AS lastMessageAt FROM integration_health WHERE account_id = ?",
      ).bind(authContext.userId).all<{
        provider: string; status: string; viewerCount: number | null; observedAt: string;
        viewerCountObservedAt: string | null; detailCode: string | null; lastMessageAt: string | null;
      }>();
      if (!result.success) return jsonError(503, "integration_health_unavailable", "Could not load provider health.", requestId);
      const byProvider = new Map((result.results ?? []).map(row => [row.provider, row]));
      const now = new Date();
      const providerHealth: ProviderHealthSnapshot[] = PROVIDERS.map(provider => {
        const row = byProvider.get(provider);
        if (!row) return emptyProviderHealth(provider, now);
        const state = row.status === "healthy" ? "connected"
          : row.status === "degraded" ? "degraded"
          : row.status === "disconnected" ? "disconnected" : "error";
        return {
          provider, state, observedAt: row.observedAt, lastMessageAt: row.lastMessageAt,
          viewerCount: row.viewerCount, viewerCountObservedAt: row.viewerCountObservedAt,
          detailCode: row.detailCode, unofficial: provider === "tiktok",
        };
      });
      return Response.json({ providers: providerHealth, viewers: aggregateViewerCounts(providerHealth, now) }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/devices" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const devices = await env.DB.prepare(
        "SELECT id, platform, game_version AS gameVersion, mod_version AS modVersion, label, created_at AS createdAt, last_seen_at AS lastSeenAt FROM devices WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
      ).bind(authContext.userId).all();
      if (!devices.success) return jsonError(503, "device_store_unavailable", "Could not load devices.", requestId);
      return Response.json({ devices: devices.results ?? [] }, { headers: JSON_HEADERS });
    }

    const revokeDeviceMatch = url.pathname.match(/^\/api\/v1\/devices\/([0-9a-f-]{36})$/i);
    if (revokeDeviceMatch && request.method === "DELETE") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const deviceId = revokeDeviceMatch[1];
      const revokedAt = new Date().toISOString();
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL").bind(revokedAt, deviceId, authContext.userId),
        env.DB.prepare("UPDATE pairing_challenges SET status = 'revoked', code_digest = NULL WHERE device_id = ? AND claimed_account_id = ? AND status = 'claimed'").bind(deviceId, authContext.userId),
      ]);
      if (!results[0]?.success) return jsonError(503, "device_store_unavailable", "Could not revoke device.", requestId);
      if ((results[0]?.meta?.changes ?? 0) !== 1) return jsonError(404, "device_not_found", "Active device was not found.", requestId);
      return Response.json({ status: "revoked", deviceId }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/pairing/challenges" && request.method === "POST") {
      if (!isJson(request)) return jsonError(415, "content_type_required", "Send a JSON request body.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Local database binding is not configured.", requestId);
      if (!env.PAIRING_HMAC_KEY || env.PAIRING_HMAC_KEY.length < 32) {
        return jsonError(503, "pairing_not_configured", "Pairing security is not configured.", requestId);
      }

      let body: unknown;
      try { body = await readJson(request); }
      catch (error) {
        const message = error instanceof Error ? error.message : "invalid_json";
        if (message === "body_too_large") return jsonError(413, "body_too_large", "Request body exceeds 4 KiB.", requestId);
        return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId);
      }

      const parsed = validateCreatePairingChallenge(body);
      if (!parsed.ok) return Response.json({
        error: { code: "validation_failed", message: "Pairing challenge fields are invalid.", requestId },
        issues: parsed.issues,
      }, { status: 400, headers: JSON_HEADERS });

      const result = await createPairingChallenge(env.DB, {
        ...parsed.value, challengeId: crypto.randomUUID(), now: new Date(),
      }, env.PAIRING_HMAC_KEY);

      if (!result.ok) {
        if (result.reason === "code_conflict") return jsonError(409, "code_collision", "Choose a new five-digit code and retry.", requestId);
        if (result.reason === "too_many_active") return jsonError(429, "too_many_active_challenges", "Too many active challenges for this device.", requestId);
        return jsonError(503, "pairing_store_unavailable", "Could not store the pairing challenge.", requestId);
      }

      // Deliberately do not echo the code or its digest.
      return Response.json({
        challengeId: result.challengeId, status: "pending", expiresAt: result.expiresAt, pollAfterMs: 1500,
      }, { status: 201, headers: JSON_HEADERS });
    }

    const statusMatch = url.pathname.match(/^\/api\/v1\/pairing\/challenges\/([0-9a-f-]{36})$/i);
    if (statusMatch && request.method === "GET") {
      if (!env.DB) return jsonError(503, "database_unavailable", "Local database binding is not configured.", requestId);
      const challenge = await env.DB.prepare(
        "SELECT status, expires_at, claimed_at FROM pairing_challenges WHERE id = ? LIMIT 1",
      ).bind(statusMatch[1]).first<{ status: string; expires_at: string; claimed_at: string | null }>();
      if (!challenge) return jsonError(404, "challenge_not_found", "Pairing challenge was not found.", requestId);
      const status = challenge.status === "pending" && challenge.expires_at <= new Date().toISOString()
        ? "expired" : challenge.status;
      return Response.json({
        challengeId: statusMatch[1], status, expiresAt: challenge.expires_at,
        ...(challenge.claimed_at ? { claimedAt: challenge.claimed_at } : {}),
      }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/pairing/claim" && request.method === "POST") {
      if (!isJson(request)) return jsonError(415, "content_type_required", "Send a JSON request body.", requestId);
      let body: unknown;
      try { body = await readJson(request); }
      catch { return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId); }
      const parsed = validateClaimPairing(body);
      if (!parsed.ok) return Response.json({
        error: { code: "validation_failed", message: "Pairing code is invalid.", requestId },
        issues: parsed.issues,
      }, { status: 400, headers: JSON_HEADERS });
      if (!env.DB || !env.PAIRING_HMAC_KEY || env.PAIRING_HMAC_KEY.length < 32) {
        return jsonError(503, "pairing_not_configured", "Pairing security is not configured.", requestId);
      }
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);

      const result = await claimPairingChallenge(env.DB, parsed.value.code, env.PAIRING_HMAC_KEY, authContext.userId, new Date());
      if (!result.ok) {
        if (result.reason === "invalid_or_expired") return jsonError(400, "invalid_or_expired_code", "The pairing code is invalid, expired, or already used.", requestId);
        return jsonError(503, "pairing_store_unavailable", "Could not claim this device.", requestId);
      }
      return Response.json({ status: "claimed", deviceId: result.deviceId, platform: result.platform }, { headers: JSON_HEADERS });
    }

    if (url.pathname.startsWith("/api/")) return jsonError(404, "not_found", "API route was not found.", requestId);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> };
