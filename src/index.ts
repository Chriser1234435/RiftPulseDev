import type { Env } from "./env.ts";
import { API_VERSION, SUPPORTED_MODULES, validateCreatePairingChallenge, validateClaimPairing } from "../packages/contracts/src/v1.ts";
import { createPairingChallenge } from "../packages/shared/src/pairing.ts";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

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
      // Account claiming is intentionally disabled until the authenticated website session exists.
      return jsonError(401, "authentication_required", "Sign in to RiftPulse before claiming a device.", requestId);
    }

    return jsonError(404, "not_found", "API route was not found.", requestId);
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> };
