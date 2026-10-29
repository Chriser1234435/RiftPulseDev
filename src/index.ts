import type { Env } from "./env.ts";
import { API_VERSION, PROVIDERS, SUPPORTED_MODULES, validateCreatePairingChallenge, validateClaimPairing } from "../packages/contracts/src/v1.ts";
import type { ProviderHealthSnapshot } from "../packages/contracts/src/chat-v1.ts";
import { aggregateViewerCounts, emptyProviderHealth, normalizeKickChatMessage, normalizeTwitchChatMessage } from "../packages/shared/src/chat.ts";
import { persistNormalizedChatMessage } from "../packages/shared/src/chat-persistence.ts";
import { extractKickPublicKey, verifyKickWebhookSignature } from "../packages/shared/src/kick-webhook.ts";
import { verifyTwitchEventSubSignature } from "../packages/shared/src/twitch-eventsub.ts";
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
