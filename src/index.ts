import type { Env } from "./env.ts";
import { API_VERSION, PROVIDERS, SUPPORTED_MODULES, validateCreatePairingChallenge, validateClaimPairing } from "../packages/contracts/src/v1.ts";
import type { ProviderHealthSnapshot } from "../packages/contracts/src/chat-v1.ts";
import { aggregateViewerCounts, emptyProviderHealth } from "../packages/shared/src/chat.ts";
import { claimPairingChallenge, createPairingChallenge } from "../packages/shared/src/pairing.ts";
import { createAuth } from "./auth.ts";

const VERSION = "0.1.0-dev";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

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
