import type { Env } from "./env.ts";
import { API_VERSION, PROVIDERS, SUPPORTED_MODULES, validateCreatePairingChallenge, validateClaimPairing } from "../packages/contracts/src/v1.ts";
import type { NormalizedProviderEvent, ProviderHealthSnapshot } from "../packages/contracts/src/chat-v1.ts";
import { aggregateViewerCounts, emptyProviderHealth, normalizeKickChatMessage, normalizePlatformProviderEvent, normalizeTikTokChatMessage, normalizeTikTokProviderEvent, normalizeTwitchChatMessage, normalizeYouTubeChatMessage, normalizeYouTubeProviderEvent } from "../packages/shared/src/chat.ts";
import { persistNormalizedChatMessage } from "../packages/shared/src/chat-persistence.ts";
import { persistNormalizedProviderEvent } from "../packages/shared/src/provider-event-persistence.ts";
import { verifyTikTokConnectorSignature } from "../packages/shared/src/tiktok-connector-signature.ts";
import { extractKickPublicKey, verifyKickWebhookSignature } from "../packages/shared/src/kick-webhook.ts";
import { verifyTwitchEventSubSignature } from "../packages/shared/src/twitch-eventsub.ts";
import { createOAuthState, createPkceChallenge, createPkceVerifier, digestOAuthState } from "../packages/shared/src/oauth-state.ts";
import { decryptProviderToken, encryptProviderToken } from "../packages/shared/src/provider-token-vault.ts";
import { disconnectProvider, ensureFreshTwitchProviderTokens, persistProviderTokens, readProviderTokens } from "../packages/shared/src/provider-connections.ts";
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
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chat.message", message }),
    }));
  } catch { /* Chat history remains durable; realtime delivery is best-effort. */ }
}

async function publishProviderEvent(env: Env, accountId: string, event: NormalizedProviderEvent): Promise<void> {
  if (!env.CHAT_ROOM) return;
  try {
    const roomId = env.CHAT_ROOM.idFromName(accountId);
    const room = env.CHAT_ROOM.get(roomId);
    await room.fetch(new Request("https://chat-room/publish", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "provider.event", event }),
    }));
  } catch { /* Event history remains durable; realtime delivery is best-effort. */ }
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

function youtubeStateCookie(state: string | null, secure: boolean): string {
  const base = "rp_youtube_oauth_state=" + (state ?? "") + "; Path=/api/v1/providers/youtube/callback; HttpOnly; SameSite=Lax; Max-Age=" + (state ? "600" : "0");
  return secure ? base + "; Secure" : base;
}

function kickStateCookie(state: string | null, secure: boolean): string {
  const base = "rp_kick_oauth_state=" + (state ?? "") + "; Path=/api/v1/providers/kick/callback; HttpOnly; SameSite=Lax; Max-Age=" + (state ? "600" : "0");
  return secure ? base + "; Secure" : base;
}

function providerRedirect(env: Env, provider: "twitch" | "youtube" | "kick", status: string): Response {
  let target: URL;
  try { target = new URL(env.APP_BASE_URL ?? "http://127.0.0.1:5173"); }
  catch { target = new URL("http://127.0.0.1:5173"); }
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  target.searchParams.set("provider", provider);
  target.searchParams.set("status", status);
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    // Keep Cloudflare as the browser-facing origin, but run all API logic on Railway.
    // This also keeps Better Auth cookies same-origin for the Cloudflare-hosted UI.
    if (env.RAILWAY_API_URL && url.pathname.startsWith("/api/")) {
      try {
        const upstream = new URL(url.pathname + url.search, env.RAILWAY_API_URL);
        const headers = new Headers(request.headers);
        headers.delete("host");
        const init: RequestInit & { duplex?: "half" } = {
          method: request.method,
          headers,
          redirect: request.redirect,
          signal: request.signal,
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
          init.body = request.body;
          init.duplex = "half";
        }
        return await fetch(new Request(upstream, init));
      } catch {
        return jsonError(502, "api_upstream_unavailable", "The RiftPulse API service is temporarily unavailable.", requestId);
      }
    }

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

    if (url.pathname === "/api/v1/providers/tiktok/settings" && (request.method === "GET" || request.method === "PUT")) {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "TikTok settings storage is not configured.", requestId);
      if (request.method === "PUT") {
        if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
        let body: unknown;
        try { body = await request.json(); } catch { return jsonError(400, "invalid_json", "Request body must be valid JSON.", requestId); }
        if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).username !== "string") {
          return jsonError(400, "invalid_tiktok_username", "Enter a public TikTok username.", requestId);
        }
        const username = ((body as Record<string, unknown>).username as string).trim().replace(/^@/, "");
        if (username.length > 24 || (username !== "" && !/^[A-Za-z0-9._]{2,24}$/.test(username))) {
          return jsonError(400, "invalid_tiktok_username", "Enter the username only (2–24 letters, numbers, dots, or underscores); do not paste a URL.", requestId);
        }
        const now = new Date().toISOString();
        const saved = await env.DB.prepare(
          "INSERT INTO provider_settings (account_id, provider, settings_json, updated_at) VALUES (?, 'tiktok', ?, ?) ON CONFLICT(account_id, provider) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at",
        ).bind(authContext.userId, JSON.stringify({ username }), now).run();
        if (!saved.success) return jsonError(503, "tiktok_settings_store_unavailable", "Could not save TikTok settings.", requestId);
        return Response.json({ accountId: authContext.userId, username, saved: true, updatedAt: now }, { headers: JSON_HEADERS });
      }
      const row = await env.DB.prepare(
        "SELECT settings_json AS settingsJson, updated_at AS updatedAt FROM provider_settings WHERE account_id = ? AND provider = 'tiktok' LIMIT 1",
      ).bind(authContext.userId).first<{ settingsJson: string; updatedAt: string }>();
      let username = "";
      try {
        const settings = row ? JSON.parse(row.settingsJson) as Record<string, unknown> : {};
        if (typeof settings.username === "string") username = settings.username;
      } catch { /* treat malformed settings as empty */ }
      return Response.json({ accountId: authContext.userId, username, saved: !!row, updatedAt: row?.updatedAt ?? null }, { headers: JSON_HEADERS });
    }
    if (url.pathname === "/api/v1/internal/tiktok/accounts" && request.method === "GET") {
      if (!env.DB || !env.TIKTOK_CONNECTOR_INGEST_SECRET) {
        return jsonError(503, "tiktok_connector_not_configured", "TikTok connector is not configured.", requestId);
      }
      const authorization = request.headers.get("authorization") ?? "";
      if (authorization !== "Bearer " + env.TIKTOK_CONNECTOR_INGEST_SECRET) {
        return jsonError(401, "internal_auth_required", "Connector authentication is required.", requestId);
      }
      const rows = await env.DB.prepare(
        "SELECT ps.account_id AS accountId, ps.settings_json AS settingsJson FROM provider_settings ps INNER JOIN accounts a ON a.id = ps.account_id WHERE ps.provider = 'tiktok' ORDER BY ps.updated_at DESC LIMIT 200",
      ).all<{ accountId: string; settingsJson: string }>();
      if (!rows.success) return jsonError(503, "tiktok_accounts_unavailable", "Could not load TikTok account settings.", requestId);
      const accounts: Array<{ accountId: string; username: string }> = [];
      for (const row of rows.results ?? []) {
        try {
          const settings = JSON.parse(row.settingsJson) as Record<string, unknown>;
          const username = typeof settings.username === "string" ? settings.username.trim().replace(/^@/, "") : "";
          if (username && /^[A-Za-z0-9._]{2,24}$/.test(username)) accounts.push({ accountId: row.accountId, username });
        } catch { /* Skip malformed settings safely. */ }
      }
      return Response.json({ accounts: accounts.slice(0, 50) }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/internal/tiktok/status" && request.method === "POST") {
      if (!env.DB || !env.TIKTOK_CONNECTOR_INGEST_SECRET) return jsonError(503, "tiktok_connector_not_configured", "TikTok connector is not configured.", requestId);
      if ((request.headers.get("authorization") ?? "") !== "Bearer " + env.TIKTOK_CONNECTOR_INGEST_SECRET) {
        return jsonError(401, "internal_auth_required", "Connector authentication is required.", requestId);
      }
      let body: unknown;
      try { body = await request.json(); } catch { return jsonError(400, "invalid_json", "Status payload must be valid JSON.", requestId); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_status_payload", "Status payload must be an object.", requestId);
      const value = body as Record<string, unknown>;
      if (typeof value.accountId !== "string" || !value.accountId || typeof value.username !== "string"
        || !["connected", "disconnected", "error"].includes(String(value.status))
        || (value.channelId !== undefined && (typeof value.channelId !== "string" || value.channelId.length > 128))) {
        return jsonError(400, "invalid_status_payload", "Account, username, and supported status are required.", requestId);
      }
      const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ? LIMIT 1").bind(value.accountId).first<{ id: string }>();
      if (!account) return jsonError(404, "connector_account_not_found", "The target RiftPulse account does not exist.", requestId);
      const configured = await env.DB.prepare("SELECT settings_json AS settingsJson FROM provider_settings WHERE account_id = ? AND provider = 'tiktok' LIMIT 1").bind(value.accountId).first<{ settingsJson: string }>();
      let username = "";
      try { const settings = configured ? JSON.parse(configured.settingsJson) as Record<string, unknown> : {}; username = typeof settings.username === "string" ? settings.username.trim().replace(/^@/, "") : ""; } catch { username = ""; }
      const requestedUsername = value.username.trim().replace(/^@/, "");
      if (value.status !== "disconnected" && (!username || username.toLowerCase() !== requestedUsername.toLowerCase())) {
        return jsonError(403, "tiktok_account_binding_mismatch", "The status does not match the configured TikTok username.", requestId);
      }
      const now = new Date().toISOString();
      const isConnected = value.status === "connected";
      const connection = await env.DB.prepare(
        "INSERT INTO provider_connections (id, account_id, provider, external_account_id, display_name, status, connected_at, updated_at) VALUES (?, ?, 'tiktok', ?, ?, ?, ?, ?) ON CONFLICT(account_id, provider) DO UPDATE SET external_account_id = CASE WHEN excluded.status = 'connected' THEN excluded.external_account_id ELSE provider_connections.external_account_id END, display_name = excluded.display_name, status = excluded.status, connected_at = CASE WHEN excluded.status = 'connected' THEN COALESCE(provider_connections.connected_at, excluded.connected_at) ELSE provider_connections.connected_at END, updated_at = excluded.updated_at",
      ).bind(crypto.randomUUID(), value.accountId, typeof value.channelId === "string" ? value.channelId : null, requestedUsername, isConnected ? "connected" : value.status === "error" ? "error" : "disconnected", isConnected ? now : null, now).run();
      if (!connection.success) return jsonError(503, "provider_connection_store_unavailable", "Could not update TikTok connection status.", requestId);
      const healthStatus = isConnected ? "healthy" : value.status === "error" ? "error" : "disconnected";
      const detail = isConnected ? null : value.status === "error" ? "connector_error" : "tiktok_stream_offline";
      const health = await env.DB.prepare(
        "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'tiktok', ?, NULL, ?, ?, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = excluded.status, viewer_count = NULL, observed_at = excluded.observed_at, detail_code = excluded.detail_code, viewer_count_observed_at = NULL",
      ).bind(crypto.randomUUID(), value.accountId, healthStatus, now, detail).run();
      if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update TikTok health status.", requestId);
      return Response.json({ status: healthStatus }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/providers/tiktok/ingest" && request.method === "POST") {
      if (!env.DB || !env.TIKTOK_CONNECTOR_INGEST_SECRET || !env.CHAT_ROOM) {
        return jsonError(503, "tiktok_connector_not_configured", "The isolated TikTok connector bridge is not configured.", requestId);
      }
      const timestamp = request.headers.get("x-riftpulse-timestamp") ?? "";
      const signature = request.headers.get("x-riftpulse-signature") ?? "";
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).byteLength > 16_384) return jsonError(413, "body_too_large", "Connector payload exceeds the size limit.", requestId);
      if (!await verifyTikTokConnectorSignature(timestamp, signature, rawBody, env.TIKTOK_CONNECTOR_INGEST_SECRET)) {
        return jsonError(401, "invalid_connector_signature", "Connector signature or timestamp is invalid.", requestId);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(rawBody) as unknown; } catch { return jsonError(400, "invalid_connector_json", "Connector payload is not valid JSON.", requestId); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonError(400, "invalid_connector_payload", "Connector payload must be an object.", requestId);
      const body = parsed as Record<string, unknown>;
      if (typeof body.accountId !== "string" || !body.accountId || body.accountId.length > 128
        || typeof body.channelId !== "string" || !body.channelId || body.channelId.length > 128
        || typeof body.channelName !== "string" || body.channelName.length > 80
        || (body.kind !== "chat" && body.kind !== "event" && body.kind !== "viewers") || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
        return jsonError(400, "invalid_connector_payload", "Account, channel, kind, and event payload are required.", requestId);
      }
      const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ? LIMIT 1").bind(body.accountId).first<{ id: string }>();
      if (!account) return jsonError(404, "connector_account_not_found", "The target RiftPulse account does not exist.", requestId);
      const configured = await env.DB.prepare(
        "SELECT settings_json AS settingsJson FROM provider_settings WHERE account_id = ? AND provider = 'tiktok' LIMIT 1",
      ).bind(body.accountId).first<{ settingsJson: string }>();
      let configuredUsername = "";
      try {
        const settings = configured ? JSON.parse(configured.settingsJson) as Record<string, unknown> : {};
        configuredUsername = typeof settings.username === "string" ? settings.username.trim().replace(/^@/, "") : "";
      } catch { configuredUsername = ""; }
      if (!configuredUsername || configuredUsername.toLowerCase() !== String(body.channelName).replace(/^@/, "").toLowerCase()) {
        return jsonError(403, "tiktok_account_binding_mismatch", "The event does not match the TikTok username configured for this RiftPulse account.", requestId);
      }
      const now = new Date();
      let inserted = false;
      let eventKind: string | null = null;
      let normalizedViewerCount: number | null = null;
      if (body.kind === "chat") {
        const message = normalizeTikTokChatMessage(body.payload, body.channelId, body.channelName, now);
        if (!message) return jsonError(400, "invalid_tiktok_chat", "TikTok chat payload is missing required fields.", requestId);
        const stored = await persistNormalizedChatMessage(env.DB, body.accountId, message);
        if (!stored.ok) return jsonError(503, "chat_store_unavailable", "Could not store TikTok chat.", requestId);
        inserted = stored.inserted;
        if (inserted) await publishChatMessage(env, body.accountId, message);
      } else if (body.kind === "viewers") {
        const event = normalizeTikTokProviderEvent("roomUser", body.payload, body.channelId, body.channelName, now);
        if (!event || event.kind !== "viewer_count") return jsonError(400, "invalid_tiktok_viewers", "TikTok viewer statistics are invalid.", requestId);
        eventKind = event.kind;
        normalizedViewerCount = event.quantity;
      } else {
        if (typeof body.eventName !== "string" || body.eventName.length > 80) return jsonError(400, "invalid_tiktok_event", "TikTok event name is required.", requestId);
        const event = normalizeTikTokProviderEvent(body.eventName, body.payload, body.channelId, body.channelName, now);
        if (!event) return jsonError(400, "invalid_tiktok_event", "TikTok event type or payload is not supported.", requestId);
        eventKind = event.kind;
        if (event.kind === "viewer_count") {
          // ROOM_USER is periodic telemetry, not a user-facing event. Update the live
          // count below without persisting/broadcasting a new feed row every interval.
          normalizedViewerCount = event.quantity;
        } else {
          const stored = await persistNormalizedProviderEvent(env.DB, body.accountId, event);
          if (!stored.ok) return jsonError(503, "provider_event_store_unavailable", "Could not store TikTok stream event.", requestId);
          inserted = stored.inserted;
          if (inserted) await publishProviderEvent(env, body.accountId, event);
        }
      }
      const connection = await env.DB.prepare(
        "INSERT INTO provider_connections (id, account_id, provider, external_account_id, display_name, status, connected_at, updated_at) VALUES (?, ?, 'tiktok', ?, ?, 'connected', ?, ?) ON CONFLICT(account_id, provider) DO UPDATE SET external_account_id = excluded.external_account_id, display_name = excluded.display_name, status = 'connected', connected_at = COALESCE(provider_connections.connected_at, excluded.connected_at), updated_at = excluded.updated_at"
      ).bind(crypto.randomUUID(), body.accountId, body.channelId, body.channelName, now.toISOString(), now.toISOString()).run();
      if (!connection.success) return jsonError(503, "provider_connection_store_unavailable", "Could not update TikTok connector status.", requestId);
      const viewerCount = (body.kind === "viewers" || (body.kind === "event" && eventKind === "viewer_count"))
        && normalizedViewerCount !== null && Number.isSafeInteger(normalizedViewerCount) && normalizedViewerCount >= 0
        ? normalizedViewerCount : null;
      const health = await env.DB.prepare(
        "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'tiktok', 'healthy', ?, ?, NULL, ?) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', viewer_count = COALESCE(excluded.viewer_count, integration_health.viewer_count), observed_at = excluded.observed_at, detail_code = NULL, viewer_count_observed_at = COALESCE(excluded.viewer_count_observed_at, integration_health.viewer_count_observed_at)"
      ).bind(crypto.randomUUID(), body.accountId, viewerCount, now.toISOString(), viewerCount === null ? null : now.toISOString()).run();
      if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update TikTok connector health.", requestId);
      return Response.json({ status: eventKind === "viewer_count" ? "accepted" : inserted ? "accepted" : "duplicate", kind: body.kind, eventKind }, { headers: JSON_HEADERS });
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
      const twitchConfigured = !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY && env.APP_BASE_URL);
      const youtubeConfigured = !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY && env.APP_BASE_URL);
      const kickConfigured = !!(env.KICK_CLIENT_ID && env.KICK_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY && env.APP_BASE_URL);
      const tiktokConfigured = !!(env.TIKTOK_CONNECTOR_INGEST_SECRET && env.APP_BASE_URL);
      const connections = PROVIDERS.map(provider => {
        const row = rows.get(provider);
        return {
          provider,
          status: row?.status ?? "disconnected",
          displayName: row?.displayName ?? null,
          connectedAt: row?.connectedAt ?? null,
          configured: provider === "twitch" ? twitchConfigured : provider === "youtube" ? youtubeConfigured : provider === "kick" ? kickConfigured : provider === "tiktok" ? tiktokConfigured : false,
          detailCode: provider === "tiktok" && !tiktokConfigured ? "unofficial_connector_not_configured"
            : provider === "twitch" && !twitchConfigured ? "oauth_credentials_not_configured"
            : provider === "youtube" && !youtubeConfigured ? "oauth_credentials_not_configured"
            : provider === "kick" && !kickConfigured ? "oauth_credentials_not_configured"
            : provider === "twitch" && row?.status === "connected" && row.healthStatus !== "healthy" ? row?.healthDetailCode ?? "eventsub_subscription_pending"
            : provider === "youtube" && row?.status === "connected" && row.healthStatus !== "healthy" ? row?.healthDetailCode ?? "live_chat_polling_pending"
            : provider === "kick" && row?.status === "connected" && row.healthStatus !== "healthy" ? row?.healthDetailCode ?? "webhook_subscription_pending"
            : row?.healthDetailCode ?? null,
        };
      });
      return Response.json({ connections }, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/v1/providers/youtube/connect" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) {
        return jsonError(503, "youtube_oauth_not_configured", "Google OAuth credentials, app URL, and token encryption key must be configured locally first.", requestId);
      }
      let appUrl: URL, redirectUri: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.YOUTUBE_REDIRECT_URI ?? "/api/v1/providers/youtube/callback", appUrl);
      } catch {
        return jsonError(503, "youtube_oauth_not_configured", "The YouTube OAuth callback URL is invalid.", requestId);
      }
      if (redirectUri.origin !== appUrl.origin || redirectUri.pathname !== "/api/v1/providers/youtube/callback"
        || redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash
        || (redirectUri.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(redirectUri.hostname))) {
        return jsonError(503, "youtube_oauth_not_configured", "The callback must be the exact same-origin registered Google OAuth callback URL.", requestId);
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
      const cleanup = await env.DB.prepare(
        "DELETE FROM provider_oauth_states WHERE expires_at <= ? OR (account_id = ? AND provider = 'youtube' AND consumed_at IS NULL)",
      ).bind(nowIso, authContext.userId).run();
      if (!cleanup.success) return jsonError(503, "oauth_state_store_unavailable", "Could not prepare a secure authorization attempt.", requestId);
      const state = createOAuthState();
      const digest = await digestOAuthState(state);
      const inserted = await env.DB.prepare(
        "INSERT INTO provider_oauth_states (state_digest, account_id, provider, created_at, expires_at, consumed_at) VALUES (?, ?, 'youtube', ?, ?, NULL)",
      ).bind(digest, authContext.userId, nowIso, expiresAt).run();
      if (!inserted.success) return jsonError(503, "oauth_state_store_unavailable", "Could not start a secure authorization attempt.", requestId);

      const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorizationUrl.searchParams.set("client_id", env.YOUTUBE_CLIENT_ID);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly");
      authorizationUrl.searchParams.set("access_type", "offline");
      authorizationUrl.searchParams.set("include_granted_scopes", "true");
      authorizationUrl.searchParams.set("prompt", "consent");
      authorizationUrl.searchParams.set("state", state);
      return Response.json({ authorizationUrl: authorizationUrl.toString() }, {
        headers: { ...JSON_HEADERS, "set-cookie": youtubeStateCookie(state, redirectUri.protocol === "https:") },
      });
    }

    if (url.pathname === "/api/v1/providers/kick/connect" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) {
        return jsonError(503, "kick_oauth_not_configured", "Kick OAuth credentials, app URL, and token encryption key must be configured locally first.", requestId);
      }
      let appUrl: URL, redirectUri: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.KICK_REDIRECT_URI ?? "/api/v1/providers/kick/callback", appUrl);
      } catch {
        return jsonError(503, "kick_oauth_not_configured", "The Kick OAuth callback URL is invalid.", requestId);
      }
      if (redirectUri.origin !== appUrl.origin || redirectUri.pathname !== "/api/v1/providers/kick/callback"
        || redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash
        || (redirectUri.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(redirectUri.hostname))) {
        return jsonError(503, "kick_oauth_not_configured", "The callback must be the exact same-origin registered Kick OAuth callback URL.", requestId);
      }

      const state = createOAuthState();
      const verifier = createPkceVerifier();
      const challenge = await createPkceChallenge(verifier);
      const encryptedVerifier = await encryptProviderToken(verifier, env.TOKEN_ENCRYPTION_KEY);
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
      const cleanup = await env.DB.prepare(
        "DELETE FROM provider_oauth_states WHERE expires_at <= ? OR (account_id = ? AND provider = 'kick' AND consumed_at IS NULL)",
      ).bind(nowIso, authContext.userId).run();
      if (!cleanup.success) return jsonError(503, "oauth_state_store_unavailable", "Could not prepare a secure authorization attempt.", requestId);
      const digest = await digestOAuthState(state);
      const inserted = await env.DB.prepare(
        "INSERT INTO provider_oauth_states (state_digest, account_id, provider, created_at, expires_at, consumed_at, code_verifier_ciphertext) VALUES (?, ?, 'kick', ?, ?, NULL, ?)",
      ).bind(digest, authContext.userId, nowIso, expiresAt, encryptedVerifier).run();
      if (!inserted.success) return jsonError(503, "oauth_state_store_unavailable", "Could not start a secure authorization attempt.", requestId);

      const authorizationUrl = new URL("https://id.kick.com/oauth/authorize");
      authorizationUrl.searchParams.set("client_id", env.KICK_CLIENT_ID);
      authorizationUrl.searchParams.set("response_type", "code");
      if (redirectUri.hostname === "127.0.0.1") authorizationUrl.searchParams.set("redirect", "127.0.0.1");
      authorizationUrl.searchParams.set("redirect_uri", redirectUri.toString());
      authorizationUrl.searchParams.set("scope", "user:read channel:read events:subscribe");
      authorizationUrl.searchParams.set("code_challenge", challenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("state", state);
      return Response.json({ authorizationUrl: authorizationUrl.toString() }, {
        headers: { ...JSON_HEADERS, "set-cookie": kickStateCookie(state, redirectUri.protocol === "https:") },
      });
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
      authorizationUrl.searchParams.set("scope", "user:read:chat user:bot channel:bot moderator:read:followers channel:read:subscriptions bits:read");
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
        const response = providerRedirect(env, "twitch", status);
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
        const requiredScopes = ["user:read:chat", "user:bot", "channel:bot", "moderator:read:followers", "channel:read:subscriptions", "bits:read"];
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

    if (url.pathname === "/api/v1/providers/youtube/callback" && request.method === "GET") {
      const state = url.searchParams.get("state");
      const cookieState = readCookie(request, "rp_youtube_oauth_state");
      const secureCookie = url.protocol === "https:";
      const finish = (status: string) => {
        const response = providerRedirect(env, "youtube", status);
        response.headers.append("set-cookie", youtubeStateCookie(null, secureCookie));
        response.headers.set("cache-control", "no-store");
        response.headers.set("referrer-policy", "no-referrer");
        return response;
      };
      if (!env.DB || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL
        || !state || state !== cookieState || !/^[a-f0-9]{64}$/i.test(state)) return finish("failed");
      const digest = await digestOAuthState(state);
      const now = new Date();
      const claimedState = await env.DB.prepare(
        "UPDATE provider_oauth_states SET consumed_at = ? WHERE state_digest = ? AND provider = 'youtube' AND consumed_at IS NULL AND expires_at > ? RETURNING account_id",
      ).bind(now.toISOString(), digest, now.toISOString()).first<{ account_id: string }>();
      if (!claimedState?.account_id) return finish("failed");
      if (url.searchParams.has("error")) return finish("denied");
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048) return finish("failed");

      let appUrl: URL, redirectUri: URL;
      try {
        appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.YOUTUBE_REDIRECT_URI ?? "/api/v1/providers/youtube/callback", appUrl);
      } catch { return finish("failed"); }
      if (redirectUri.origin !== appUrl.origin || redirectUri.pathname !== "/api/v1/providers/youtube/callback"
        || redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash) return finish("failed");

      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            client_id: env.YOUTUBE_CLIENT_ID,
            client_secret: env.YOUTUBE_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri.toString(),
          }),
        });
        if (!tokenResponse.ok) return finish("failed");
        const tokenPayload: unknown = await tokenResponse.json();
        if (!tokenPayload || typeof tokenPayload !== "object" || Array.isArray(tokenPayload)) return finish("failed");
        const token = tokenPayload as Record<string, unknown>;
        if (typeof token.access_token !== "string" || !token.access_token
          || typeof token.refresh_token !== "string" || !token.refresh_token
          || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0
          || typeof token.scope !== "string") return finish("failed");
        const scopes = token.scope.split(/\s+/).filter(Boolean);
        if (!scopes.includes("https://www.googleapis.com/auth/youtube.readonly")) return finish("failed");

        const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet&mine=true", {
          headers: { authorization: "Bearer " + token.access_token, accept: "application/json" },
        });
        if (!channelResponse.ok) return finish("failed");
        const channelPayload: unknown = await channelResponse.json();
        if (!channelPayload || typeof channelPayload !== "object" || Array.isArray(channelPayload)) return finish("failed");
        const items = (channelPayload as Record<string, unknown>).items;
        if (!Array.isArray(items) || !items.length || !items[0] || typeof items[0] !== "object" || Array.isArray(items[0])) return finish("failed");
        const channel = items[0] as Record<string, unknown>;
        const snippet = typeof channel.snippet === "object" && channel.snippet !== null && !Array.isArray(channel.snippet)
          ? channel.snippet as Record<string, unknown> : {};
        if (typeof channel.id !== "string" || !channel.id) return finish("failed");

        const saved = await persistProviderTokens(env.DB, {
          accountId: claimedState.account_id, provider: "youtube", externalAccountId: channel.id,
          displayName: typeof snippet.title === "string" ? snippet.title : null,
          accessToken: token.access_token, refreshToken: token.refresh_token,
          tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(), scopes,
        }, env.TOKEN_ENCRYPTION_KEY);
        if (!saved.ok) return finish("failed");

        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'youtube', 'degraded', NULL, ?, 'live_chat_polling_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'live_chat_polling_pending', viewer_count_observed_at = NULL",
        ).bind(crypto.randomUUID(), claimedState.account_id, new Date().toISOString()).run();
        if (!health.success) return finish("failed");
        return finish("connected");
      } catch {
        return finish("failed");
      }
    }

    if (url.pathname === "/api/v1/providers/kick/callback" && request.method === "GET") {
      const state = url.searchParams.get("state");
      const cookieState = readCookie(request, "rp_kick_oauth_state");
      const secureCookie = url.protocol === "https:";
      const finish = (status: string) => {
        const response = providerRedirect(env, "kick", status);
        response.headers.append("set-cookie", kickStateCookie(null, secureCookie));
        response.headers.set("cache-control", "no-store");
        response.headers.set("referrer-policy", "no-referrer");
        return response;
      };
      if (!env.DB || !env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL
        || !state || state !== cookieState || !/^[a-f0-9]{64}$/i.test(state)) return finish("failed");
      const digest = await digestOAuthState(state);
      const now = new Date();
      const claimedState = await env.DB.prepare(
        "UPDATE provider_oauth_states SET consumed_at = ? WHERE state_digest = ? AND provider = 'kick' AND consumed_at IS NULL AND expires_at > ? RETURNING account_id, code_verifier_ciphertext",
      ).bind(now.toISOString(), digest, now.toISOString()).first<{ account_id: string; code_verifier_ciphertext: string | null }>();
      if (!claimedState?.account_id || !claimedState.code_verifier_ciphertext) return finish("failed");
      if (url.searchParams.has("error")) return finish("denied");
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048) return finish("failed");

      let redirectUri: URL;
      try {
        const appUrl = new URL(env.APP_BASE_URL);
        redirectUri = new URL(env.KICK_REDIRECT_URI ?? "/api/v1/providers/kick/callback", appUrl);
      } catch { return finish("failed"); }
      if (redirectUri.pathname !== "/api/v1/providers/kick/callback" || redirectUri.origin !== new URL(env.APP_BASE_URL).origin) return finish("failed");

      try {
        const verifier = await decryptProviderToken(claimedState.code_verifier_ciphertext, env.TOKEN_ENCRYPTION_KEY);
        const tokenResponse = await fetch("https://id.kick.com/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            client_id: env.KICK_CLIENT_ID,
            client_secret: env.KICK_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri.toString(),
            code_verifier: verifier,
          }),
        });
        if (!tokenResponse.ok) return finish("failed");
        const tokenPayload: unknown = await tokenResponse.json();
        if (!tokenPayload || typeof tokenPayload !== "object" || Array.isArray(tokenPayload)) return finish("failed");
        const token = tokenPayload as Record<string, unknown>;
        const expiresIn = typeof token.expires_in === "number" ? token.expires_in : Number(token.expires_in);
        if (typeof token.access_token !== "string" || !token.access_token
          || typeof token.refresh_token !== "string" || !token.refresh_token
          || !Number.isFinite(expiresIn) || expiresIn <= 0) return finish("failed");

        const introspectResponse = await fetch("https://api.kick.com/public/v1/token/introspect", {
          method: "POST",
          headers: { authorization: "Bearer " + token.access_token, accept: "application/json" },
        });
        if (!introspectResponse.ok) return finish("failed");
        const introspectPayload: unknown = await introspectResponse.json();
        if (!introspectPayload || typeof introspectPayload !== "object" || Array.isArray(introspectPayload)) return finish("failed");
        const introspectRoot = introspectPayload as Record<string, unknown>;
        const introspect = typeof introspectRoot.data === "object" && introspectRoot.data !== null && !Array.isArray(introspectRoot.data)
          ? introspectRoot.data as Record<string, unknown> : {};
        if (introspect.active !== true || introspect.client_id !== env.KICK_CLIENT_ID || introspect.token_type !== "user"
          || typeof introspect.scope !== "string") return finish("failed");
        const scopes = introspect.scope.split(/\s+/).filter(Boolean);
        if (!["user:read", "channel:read", "events:subscribe"].every(scope => scopes.includes(scope))) return finish("failed");

        const userResponse = await fetch("https://api.kick.com/public/v1/users", {
          headers: { authorization: "Bearer " + token.access_token, accept: "application/json" },
        });
        if (!userResponse.ok) return finish("failed");
        const userPayload: unknown = await userResponse.json();
        if (!userPayload || typeof userPayload !== "object" || Array.isArray(userPayload)) return finish("failed");
        const userData = (userPayload as Record<string, unknown>).data;
        const user = Array.isArray(userData) ? userData[0] : userData;
        if (!user || typeof user !== "object" || Array.isArray(user)) return finish("failed");
        const kickUser = user as Record<string, unknown>;
        const externalAccountId = typeof kickUser.user_id === "string" || typeof kickUser.user_id === "number" ? String(kickUser.user_id) : "";
        const displayName = typeof kickUser.name === "string" ? kickUser.name : typeof kickUser.username === "string" ? kickUser.username : "";
        if (!externalAccountId || !displayName) return finish("failed");

        const saved = await persistProviderTokens(env.DB, {
          accountId: claimedState.account_id, provider: "kick", externalAccountId, displayName,
          accessToken: token.access_token, refreshToken: token.refresh_token,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scopes,
        }, env.TOKEN_ENCRYPTION_KEY);
        if (!saved.ok) return finish("failed");

        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'kick', 'degraded', NULL, ?, 'webhook_subscription_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'webhook_subscription_pending', viewer_count_observed_at = NULL",
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

        const subscriptionSpecs = [
          { type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: connection.externalAccountId, user_id: connection.externalAccountId } },
          { type: "channel.follow", version: "2", condition: { broadcaster_user_id: connection.externalAccountId, moderator_user_id: connection.externalAccountId } },
          { type: "channel.subscribe", version: "1", condition: { broadcaster_user_id: connection.externalAccountId } },
          { type: "channel.subscription.gift", version: "1", condition: { broadcaster_user_id: connection.externalAccountId } },
          { type: "channel.subscription.message", version: "1", condition: { broadcaster_user_id: connection.externalAccountId } },
          { type: "channel.cheer", version: "1", condition: { broadcaster_user_id: connection.externalAccountId } },
        ];
        let allEnabled = true;
        for (const spec of subscriptionSpecs) {
          const listUrl = new URL("https://api.twitch.tv/helix/eventsub/subscriptions");
          listUrl.searchParams.set("type", spec.type);
          listUrl.searchParams.set("first", "100");
          const existingResponse = await fetch(listUrl, {
            headers: { "Client-Id": env.TWITCH_CLIENT_ID, authorization: "Bearer " + appToken, accept: "application/json" },
          });
          if (!existingResponse.ok) return jsonError(502, "twitch_eventsub_lookup_failed", "Could not check existing Twitch EventSub subscriptions.", requestId);
          const existingPayload: unknown = await existingResponse.json();
          const existingData = typeof existingPayload === "object" && existingPayload !== null && !Array.isArray(existingPayload)
            ? (existingPayload as Record<string, unknown>).data : null;
          const existing = Array.isArray(existingData) ? existingData.find(item => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            const sub = item as Record<string, unknown>;
            const condition = typeof sub.condition === "object" && sub.condition !== null ? sub.condition as Record<string, unknown> : {};
            const transport = typeof sub.transport === "object" && sub.transport !== null ? sub.transport as Record<string, unknown> : {};
            return sub.type === spec.type && ["enabled", "webhook_callback_verification_pending"].includes(String(sub.status))
              && Object.entries(spec.condition).every(([key, value]) => condition[key] === value)
              && transport.method === "webhook" && transport.callback === callbackUrl.toString();
          }) : null;

          if (existing && typeof existing === "object" && !Array.isArray(existing)) {
            if ((existing as Record<string, unknown>).status !== "enabled") allEnabled = false;
            continue;
          }
          const createResponse = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
            method: "POST",
            headers: {
              "Client-Id": env.TWITCH_CLIENT_ID,
              authorization: "Bearer " + appToken,
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              type: spec.type, version: spec.version, condition: spec.condition,
              transport: { method: "webhook", callback: callbackUrl.toString(), secret: env.TWITCH_EVENTSUB_SECRET },
            }),
          });
          if (!createResponse.ok) {
            await env.DB.prepare(
              "UPDATE integration_health SET status = 'degraded', observed_at = ?, detail_code = 'eventsub_subscription_failed' WHERE account_id = ? AND provider = 'twitch'",
            ).bind(new Date().toISOString(), authContext.userId).run();
            return jsonError(502, "twitch_eventsub_subscription_failed", "Twitch did not accept every requested event subscription. Reconnect Twitch to grant the required scopes and check the callback configuration.", requestId);
          }
          allEnabled = false;
        }

        const now = new Date().toISOString();
        if (allEnabled) {
          const health = await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = NULL, viewer_count_observed_at = NULL",
          ).bind(crypto.randomUUID(), authContext.userId, now).run();
          if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch provider setup status.", requestId);
          return Response.json({ status: "subscribed", alreadyEnabled: true, subscriptions: subscriptionSpecs.map(spec => spec.type) }, { headers: JSON_HEADERS });
        }
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'degraded', NULL, ?, 'eventsub_verification_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'eventsub_verification_pending', viewer_count_observed_at = NULL",
        ).bind(crypto.randomUUID(), authContext.userId, now).run();
        if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch provider setup status.", requestId);
        return Response.json({ status: "verification_pending", alreadyEnabled: false, subscriptions: subscriptionSpecs.map(spec => spec.type) }, { headers: JSON_HEADERS });
      } catch {
        return jsonError(502, "twitch_eventsub_setup_failed", "Could not complete Twitch chat setup.", requestId);
      }
    }

    if (url.pathname === "/api/v1/providers/kick/webhook/subscribe" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB || !env.TOKEN_ENCRYPTION_KEY || !env.APP_BASE_URL) return jsonError(503, "kick_webhook_not_configured", "Kick token storage and app URL must be configured.", requestId);
      let appUrl: URL;
      try { appUrl = new URL(env.APP_BASE_URL); } catch { return jsonError(503, "kick_webhook_not_configured", "The app URL is invalid.", requestId); }
      if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password) {
        return jsonError(503, "kick_webhook_requires_https", "Kick webhooks require a public HTTPS app URL configured in the Kick developer portal.", requestId);
      }
      const connection = await env.DB.prepare(
        "SELECT external_account_id AS externalAccountId FROM provider_connections WHERE account_id = ? AND provider = 'kick' AND status = 'connected' LIMIT 1",
      ).bind(authContext.userId).first<{ externalAccountId: string | null }>();
      if (!connection?.externalAccountId) return jsonError(409, "kick_not_connected", "Connect a Kick account before enabling chat events.", requestId);
      const stored = await readProviderTokens(env.DB, authContext.userId, "kick", env.TOKEN_ENCRYPTION_KEY);
      if (!stored.ok) return jsonError(409, "kick_token_unavailable", "Reconnect Kick before enabling chat events.", requestId);
      if (stored.externalAccountId !== connection.externalAccountId) return jsonError(409, "kick_account_mismatch", "Reconnect the intended Kick account before enabling chat events.", requestId);

      try {
        const introspectResponse = await fetch("https://api.kick.com/public/v1/token/introspect", {
          method: "POST",
          headers: { authorization: "Bearer " + stored.accessToken, accept: "application/json" },
        });
        if (!introspectResponse.ok) return jsonError(409, "kick_token_invalid", "Reconnect Kick before enabling chat events.", requestId);
        const payload: unknown = await introspectResponse.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return jsonError(502, "kick_token_invalid", "Kick returned an invalid token response.", requestId);
        const root = payload as Record<string, unknown>;
        const data = typeof root.data === "object" && root.data !== null && !Array.isArray(root.data) ? root.data as Record<string, unknown> : {};
        const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : [];
        if (data.active !== true || data.client_id !== env.KICK_CLIENT_ID || data.token_type !== "user"
          || !["user:read", "channel:read", "events:subscribe"].every(scope => scopes.includes(scope))) {
          return jsonError(409, "kick_scope_mismatch", "Reconnect Kick and grant the required chat-event permissions.", requestId);
        }

        const subscriptionsUrl = new URL("https://api.kick.com/public/v1/events/subscriptions");
        subscriptionsUrl.searchParams.set("broadcaster_user_id", connection.externalAccountId);
        const existingResponse = await fetch(subscriptionsUrl, {
          headers: { authorization: "Bearer " + stored.accessToken, accept: "application/json" },
        });
        if (!existingResponse.ok) return jsonError(502, "kick_subscription_lookup_failed", "Could not check existing Kick subscriptions.", requestId);
        const existingPayload: unknown = await existingResponse.json();
        const existingRoot = typeof existingPayload === "object" && existingPayload !== null && !Array.isArray(existingPayload)
          ? existingPayload as Record<string, unknown> : {};
        const existingData = Array.isArray(existingRoot.data) ? existingRoot.data : [];
        const alreadySubscribed = existingData.some(item => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const sub = item as Record<string, unknown>;
          return sub.event === "chat.message.sent" && Number(sub.version) === 1 && sub.method === "webhook";
        });

        if (!alreadySubscribed) {
          const createResponse = await fetch("https://api.kick.com/public/v1/events/subscriptions", {
            method: "POST",
            headers: { authorization: "Bearer " + stored.accessToken, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ method: "webhook", events: [{ name: "chat.message.sent", version: 1 }] }),
          });
          if (!createResponse.ok) {
            await env.DB.prepare(
              "UPDATE integration_health SET status = 'degraded', observed_at = ?, detail_code = 'webhook_subscription_failed' WHERE account_id = ? AND provider = 'kick'",
            ).bind(new Date().toISOString(), authContext.userId).run();
            return jsonError(502, "kick_subscription_failed", "Kick did not accept the chat subscription. Check the webhook URL in the Kick developer portal and the events:subscribe permission.", requestId);
          }
        }

        const now = new Date().toISOString();
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'kick', 'degraded', NULL, ?, 'waiting_for_first_event', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'waiting_for_first_event', viewer_count_observed_at = NULL",
        ).bind(crypto.randomUUID(), authContext.userId, now).run();
        if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Kick chat setup status.", requestId);
        return Response.json({ status: "subscribed", alreadySubscribed }, { headers: JSON_HEADERS });
      } catch {
        return jsonError(502, "kick_subscription_setup_failed", "Could not complete Kick chat setup.", requestId);
      }
    }

    const disconnectProviderMatch = url.pathname.match(/^\/api\/v1\/providers\/(twitch|youtube|kick|tiktok)$/);
    if (disconnectProviderMatch && request.method === "DELETE") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Provider storage is not configured.", requestId);
      const provider = disconnectProviderMatch[1] as typeof PROVIDERS[number];
      if (provider === "tiktok") return jsonError(409, "connector_lifecycle_managed_separately", "TikTok bridge lifecycle is managed separately from OAuth connections.", requestId);
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
        const event = normalizePlatformProviderEvent("twitch", String(subscription.type ?? ""), payload, messageId);
        if (!event) return Response.json({ status: "ignored", reason: "unsupported_event" }, { status: 202, headers: JSON_HEADERS });
        const connections = await env.DB.prepare(
          "SELECT account_id FROM provider_connections WHERE provider = 'twitch' AND external_account_id = ? AND status = 'connected'",
        ).bind(event.channelId).all<{ account_id: string }>();
        if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not route the Twitch stream event.", requestId);
        if (!connections.results?.length) return Response.json({ status: "ignored", reason: "channel_not_connected" }, { status: 202, headers: JSON_HEADERS });
        let insertedEvents = 0;
        for (const connection of connections.results) {
          const stored = await persistNormalizedProviderEvent(env.DB, connection.account_id, event);
          if (!stored.ok) return jsonError(503, "provider_event_store_unavailable", "Could not store the Twitch stream event.", requestId);
          if (stored.inserted) { insertedEvents++; await publishProviderEvent(env, connection.account_id, event); }
          const health = await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', observed_at = excluded.observed_at, detail_code = NULL",
          ).bind(crypto.randomUUID(), connection.account_id, new Date().toISOString()).run();
          if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Twitch provider health.", requestId);
        }
        return Response.json({ status: insertedEvents ? "accepted" : "duplicate", insertedEvents, deliveredAccounts: connections.results.length }, { headers: JSON_HEADERS });
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
        let eventPayload: unknown;
        try { eventPayload = JSON.parse(rawBody) as unknown; }
        catch { return jsonError(400, "invalid_webhook_json", "Webhook body is not valid JSON.", requestId); }
        const event = normalizePlatformProviderEvent("kick", eventType, eventPayload, messageId);
        if (!event || eventVersion !== "1") return Response.json({ status: "ignored", reason: "unsupported_event" }, { status: 202, headers: JSON_HEADERS });
        const connections = await env.DB.prepare(
          "SELECT account_id FROM provider_connections WHERE provider = 'kick' AND external_account_id = ? AND status = 'connected'",
        ).bind(event.channelId).all<{ account_id: string }>();
        if (!connections.success) return jsonError(503, "provider_connection_lookup_failed", "Could not route the Kick stream event.", requestId);
        if (!connections.results?.length) return Response.json({ status: "ignored", reason: "channel_not_connected" }, { status: 202, headers: JSON_HEADERS });
        let insertedEvents = 0;
        for (const connection of connections.results) {
          const stored = await persistNormalizedProviderEvent(env.DB, connection.account_id, event);
          if (!stored.ok) return jsonError(503, "provider_event_store_unavailable", "Could not store the Kick stream event.", requestId);
          if (stored.inserted) { insertedEvents++; await publishProviderEvent(env, connection.account_id, event); }
          const health = await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'kick', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', observed_at = excluded.observed_at, detail_code = NULL",
          ).bind(crypto.randomUUID(), connection.account_id, new Date().toISOString()).run();
          if (!health.success) return jsonError(503, "provider_health_update_failed", "Could not update Kick provider health.", requestId);
        }
        return Response.json({ status: insertedEvents ? "accepted" : "duplicate", insertedEvents, deliveredAccounts: connections.results.length }, { headers: JSON_HEADERS });
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

    if (url.pathname === "/api/v1/providers/youtube/poll" && request.method === "POST") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!isTrustedMutationOrigin(request, env)) return jsonError(403, "untrusted_origin", "Request origin is not trusted.", requestId);
      if (!env.DB || !env.TOKEN_ENCRYPTION_KEY || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
        return jsonError(503, "youtube_poll_not_configured", "YouTube credentials, token storage, and the database must be configured.", requestId);
      }

      const current = await readProviderTokens(env.DB, authContext.userId, "youtube", env.TOKEN_ENCRYPTION_KEY);
      if (!current.ok) return jsonError(409, "youtube_not_connected", "Connect a YouTube channel before polling its live chat.", requestId);
      let accessToken = current.accessToken;
      const now = new Date();
      if (!current.tokenExpiresAt || !Number.isFinite(Date.parse(current.tokenExpiresAt)) || Date.parse(current.tokenExpiresAt) <= now.getTime() + 5 * 60_000) {
        if (!current.refreshToken) return jsonError(409, "youtube_reconnect_required", "Reconnect YouTube to refresh the expired authorization.", requestId);
        try {
          const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({
              client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET,
              grant_type: "refresh_token", refresh_token: current.refreshToken,
            }),
          });
          if (!refreshResponse.ok) return jsonError(502, "youtube_token_refresh_failed", "Google could not refresh the YouTube authorization. Reconnect the provider if this continues.", requestId);
          const refreshPayload: unknown = await refreshResponse.json();
          if (!refreshPayload || typeof refreshPayload !== "object" || Array.isArray(refreshPayload)) return jsonError(502, "youtube_token_refresh_failed", "Google returned an invalid token response.", requestId);
          const token = refreshPayload as Record<string, unknown>;
          if (typeof token.access_token !== "string" || !token.access_token
            || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
            return jsonError(502, "youtube_token_refresh_failed", "Google returned an invalid token response.", requestId);
          }
          accessToken = token.access_token;
          const saved = await persistProviderTokens(env.DB, {
            accountId: authContext.userId, provider: "youtube", externalAccountId: current.externalAccountId,
            displayName: current.displayName, accessToken, refreshToken: typeof token.refresh_token === "string" ? token.refresh_token : current.refreshToken,
            tokenExpiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(), scopes: current.scopes, now,
          }, env.TOKEN_ENCRYPTION_KEY);
          if (!saved.ok) return jsonError(503, "youtube_token_store_failed", "Could not securely store refreshed YouTube credentials.", requestId);
        } catch {
          return jsonError(502, "youtube_token_refresh_failed", "Could not refresh the YouTube authorization.", requestId);
        }
      }

      try {
        const broadcastUrl = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
        broadcastUrl.searchParams.set("part", "snippet");
        broadcastUrl.searchParams.set("broadcastStatus", "active");
        broadcastUrl.searchParams.set("mine", "true");
        broadcastUrl.searchParams.set("maxResults", "5");
        const broadcastResponse = await fetch(broadcastUrl, { headers: { authorization: "Bearer " + accessToken, accept: "application/json" } });
        if (!broadcastResponse.ok) return jsonError(502, "youtube_live_broadcast_lookup_failed", "YouTube could not list the active broadcast. Check API access and quota.", requestId);
        const broadcastPayload: unknown = await broadcastResponse.json();
        const broadcastItems = broadcastPayload && typeof broadcastPayload === "object" && !Array.isArray(broadcastPayload)
          ? (broadcastPayload as Record<string, unknown>).items : null;
        const broadcast = Array.isArray(broadcastItems) ? broadcastItems.find(item => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const snippet = (item as Record<string, unknown>).snippet;
          return !!snippet && typeof snippet === "object" && !Array.isArray(snippet)
            && typeof (snippet as Record<string, unknown>).liveChatId === "string";
        }) as Record<string, unknown> | undefined : undefined;
        const snippet = broadcast && typeof broadcast.snippet === "object" && broadcast.snippet !== null && !Array.isArray(broadcast.snippet)
          ? broadcast.snippet as Record<string, unknown> : null;
        const liveChatId = typeof snippet?.liveChatId === "string" ? snippet.liveChatId : "";
        if (!liveChatId) {
          await env.DB.prepare("DELETE FROM youtube_live_chat_cursors WHERE account_id = ?").bind(authContext.userId).run();
          await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'youtube', 'degraded', NULL, ?, 'no_active_live_chat', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'no_active_live_chat', viewer_count_observed_at = NULL",
          ).bind(crypto.randomUUID(), authContext.userId, new Date().toISOString()).run();
          return Response.json({ status: "not_live", insertedMessages: 0, insertedEvents: 0, pollAfterMs: 15_000 }, { headers: JSON_HEADERS });
        }

        const cursor = await env.DB.prepare("SELECT live_chat_id AS liveChatId, next_page_token AS nextPageToken FROM youtube_live_chat_cursors WHERE account_id = ? LIMIT 1")
          .bind(authContext.userId).first<{ liveChatId: string; nextPageToken: string | null }>();
        const pageToken = cursor?.liveChatId === liveChatId ? cursor.nextPageToken : null;
        const messagesUrl = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
        messagesUrl.searchParams.set("liveChatId", liveChatId);
        messagesUrl.searchParams.set("part", "id,snippet,authorDetails");
        messagesUrl.searchParams.set("maxResults", "200");
        if (pageToken) messagesUrl.searchParams.set("pageToken", pageToken);
        const messagesResponse = await fetch(messagesUrl, { headers: { authorization: "Bearer " + accessToken, accept: "application/json" } });
        if (!messagesResponse.ok) {
          await env.DB.prepare(
            "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'youtube', 'degraded', NULL, ?, 'live_chat_api_error', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'live_chat_api_error', viewer_count_observed_at = NULL",
          ).bind(crypto.randomUUID(), authContext.userId, new Date().toISOString()).run();
          return jsonError(502, "youtube_live_chat_fetch_failed", "YouTube could not return live chat messages. Check the channel's live-chat availability and API quota.", requestId);
        }
        const messagesPayload: unknown = await messagesResponse.json();
        if (!messagesPayload || typeof messagesPayload !== "object" || Array.isArray(messagesPayload)) return jsonError(502, "youtube_live_chat_invalid_response", "YouTube returned an invalid live-chat response.", requestId);
        const payload = messagesPayload as Record<string, unknown>;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const channelName = current.displayName ?? current.externalAccountId;
        let insertedMessages = 0;
        let insertedEvents = 0;
        const receivedAt = new Date();
        for (const item of items) {
          const message = normalizeYouTubeChatMessage(item, channelName, receivedAt);
          if (message) {
            const stored = await persistNormalizedChatMessage(env.DB, authContext.userId, message);
            if (!stored.ok) return jsonError(503, "youtube_chat_store_failed", "Could not store YouTube live chat.", requestId);
            if (stored.inserted) { insertedMessages++; await publishChatMessage(env, authContext.userId, message); }
            continue;
          }
          const event = normalizeYouTubeProviderEvent(item, current.externalAccountId, channelName, receivedAt);
          if (event) {
            const stored = await persistNormalizedProviderEvent(env.DB, authContext.userId, event);
            if (!stored.ok) return jsonError(503, "youtube_event_store_failed", "Could not store a YouTube stream event.", requestId);
            if (stored.inserted) { insertedEvents++; await publishProviderEvent(env, authContext.userId, event); }
          }
        }
        const nextPageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken.length <= 2048 ? payload.nextPageToken : null;
        const savedCursor = await env.DB.prepare(
          "INSERT INTO youtube_live_chat_cursors (account_id, live_chat_id, next_page_token, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET live_chat_id = excluded.live_chat_id, next_page_token = excluded.next_page_token, updated_at = excluded.updated_at",
        ).bind(authContext.userId, liveChatId, nextPageToken, receivedAt.toISOString()).run();
        if (!savedCursor.success) return jsonError(503, "youtube_cursor_store_failed", "Could not save the YouTube live-chat cursor.", requestId);
        const health = await env.DB.prepare(
          "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'youtube', 'healthy', NULL, ?, NULL, NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'healthy', observed_at = excluded.observed_at, detail_code = NULL",
        ).bind(crypto.randomUUID(), authContext.userId, receivedAt.toISOString()).run();
        if (!health.success) return jsonError(503, "youtube_health_update_failed", "Could not update YouTube provider health.", requestId);
        const pollingIntervalMillis = typeof payload.pollingIntervalMillis === "number" && Number.isFinite(payload.pollingIntervalMillis)
          ? Math.max(5_000, Math.min(60_000, payload.pollingIntervalMillis)) : 10_000;
        return Response.json({ status: "polled", insertedMessages, insertedEvents, pollAfterMs: pollingIntervalMillis }, { headers: JSON_HEADERS });
      } catch {
        return jsonError(502, "youtube_poll_failed", "YouTube live-chat polling failed.", requestId);
      }
    }

    if (url.pathname === "/api/v1/chat/messages" && request.method === "GET") {
      const authContext = await getAuthContext(request, env);
      if (!authContext.ok) return jsonError(authContext.status, authContext.code, authContext.message, requestId);
      if (!env.DB) return jsonError(503, "database_unavailable", "Database binding is not configured.", requestId);
      const result = await env.DB.prepare(
        "SELECT * FROM (SELECT id, provider, external_message_id AS externalMessageId, channel_id AS channelId, channel_name AS channelName, sender_id AS senderId, sender_name AS senderName, text, sent_at AS sentAt, received_at AS receivedAt, badges_json AS badgesJson FROM chat_messages WHERE account_id = ? UNION ALL SELECT id, provider, external_event_id AS externalMessageId, channel_id AS channelId, channel_name AS channelName, COALESCE(actor_id, 'event') AS senderId, COALESCE(actor_name, 'Stream event') AS senderName, CASE kind WHEN 'follow' THEN 'followed the channel' WHEN 'subscription' THEN 'subscribed' WHEN 'gift' THEN 'sent ' || COALESCE(CASE WHEN quantity IS NOT NULL THEN CAST(quantity AS TEXT) || ' x ' ELSE '' END, '') || COALESCE(item_name, 'a gift') WHEN 'bits' THEN 'cheered ' || COALESCE(CAST(amount AS TEXT), '') || ' Bits' WHEN 'super_chat' THEN 'sent a Super Chat' WHEN 'donation' THEN 'donated ' || COALESCE(currency, '') || COALESCE(CAST(amount AS TEXT), '') WHEN 'like' THEN 'liked the stream' WHEN 'share' THEN 'shared the stream' WHEN 'raid' THEN 'raided the channel' WHEN 'member_join' THEN 'joined the stream' WHEN 'viewer_count' THEN 'Viewer count: ' || COALESCE(CAST(quantity AS TEXT), 'unknown') ELSE kind END || CASE WHEN message IS NOT NULL THEN ': ' || message ELSE '' END AS text, occurred_at AS sentAt, received_at AS receivedAt, '{}' AS badgesJson FROM provider_events WHERE account_id = ? AND kind != 'viewer_count') ORDER BY receivedAt DESC LIMIT 100",
      ).bind(authContext.userId, authContext.userId).all<{
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
