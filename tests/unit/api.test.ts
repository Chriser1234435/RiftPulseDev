import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../src/index.ts";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "../../src/env.ts";
import { createOAuthBasicAuthorization } from "../../packages/shared/src/oauth-state.ts";

type ChallengeRow = {
  id: string; device_id: string; platform: "pcvr" | "quest"; game_version: string;
  mod_version: string; code_digest: string | null; device_credential_digest: string | null; status: string;
  created_at: string; expires_at: string; claimed_at: string | null;
};

class FakeStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: FakeD1;
  private readonly query: string;
  constructor(db: FakeD1, query: string) { this.db = db; this.query = query; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const q = this.query.toLowerCase();
    if (q.includes("select provider from provider_oauth_states")) {
      return { provider: this.db.rootOAuthProvider } as T;
    }
    if (q.includes("select count(*) as count from pairing_challenges")) {
      const [deviceId, now] = this.values as [string, string];
      const count = [...this.db.challenges.values()].filter(row =>
        row.device_id === deviceId && row.status === "pending" && row.expires_at > now
      ).length;
      return { count } as T;
    }
    if (q.includes("select id from pairing_challenges where code_digest")) {
      const [digest, now] = this.values as [string, string];
      const found = [...this.db.challenges.values()].find(row =>
        row.code_digest === digest && row.status === "pending" && row.expires_at > now
      );
      return found ? ({ id: found.id } as T) : null;
    }
    if (q.includes("select pairing_challenges.id, pairing_challenges.status, pairing_challenges.expires_at")) {
      const [deviceId, pendingDigest, now, claimedDigest] = this.values as [string, string, string, string];
      const found = [...this.db.challenges.values()]
        .filter(row => row.device_id === deviceId && (
          (row.status === "pending" && row.device_credential_digest === pendingDigest && row.expires_at > now)
          || (row.status === "claimed" && this.db.deviceCredentialDigest === claimedDigest)
        ))
        .sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)
          || b.created_at.localeCompare(a.created_at))[0];
      return found ? ({ id: found.id, status: found.status, expires_at: found.expires_at } as T) : null;
    }
    if (q.includes("select status, expires_at, claimed_at from pairing_challenges")) {
      const [id] = this.values as [string];
      const found = this.db.challenges.get(id);
      return found ? ({ status: found.status, expires_at: found.expires_at, claimed_at: found.claimed_at } as T) : null;
    }
    if (q.includes("select devices.account_id as accountid from devices")) {
      const [digest] = this.values as [string];
      return digest === this.db.deviceCredentialDigest ? ({ accountId: this.db.deviceAccountId } as T) : null;
    }
    if (q.includes("select enabled from module_settings")) {
      const [moduleKey] = this.values as [string];
      return ({ enabled: this.db.moduleSettings.get(moduleKey)?.enabled ?? 1 } as T);
    }
    if (q.includes("select enabled, settings_json from module_settings")) {
      const [, moduleKey] = this.values as [string, string];
      return (this.db.moduleSettings.get(moduleKey) ?? null) as T | null;
    }
    return null;
  }
  async run<T>(): Promise<D1Result<T>> {
    const q = this.query.toLowerCase();
    if (q.includes("insert into pairing_challenges")) {
      const [id, device_id, platform, game_version, mod_version, code_digest, device_credential_digest, created_at, expires_at] =
        this.values as [string, string, "pcvr" | "quest", string, string, string, string, string, string];
      this.db.challenges.set(id, {
        id, device_id, platform, game_version, mod_version, code_digest, device_credential_digest, status: "pending",
        created_at, expires_at, claimed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith("update pairing_challenges")) {
      return { success: true, meta: { changes: 0 } };
    }
    if (q.startsWith("insert or ignore into module_settings")) {
      const [, accountId, moduleKey] = this.values as [string, string, string, string];
      if (!this.db.moduleSettings.has(moduleKey)) this.db.moduleSettings.set(moduleKey, { enabled: 1, settings_json: "{}" });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith("update module_settings set enabled")) {
      const [enabled, settingsJson, , , moduleKey] = this.values as [number, string, string, string, string];
      this.db.moduleSettings.set(moduleKey, { enabled, settings_json: settingsJson });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
}

class FakeD1 implements D1Database {
  readonly challenges = new Map<string, ChallengeRow>();
  rootOAuthProvider = "twitch";
  deviceCredentialDigest: string | null = null;
  deviceAccountId = "test-account";
  readonly moduleSettings = new Map<string, { enabled: number; settings_json: string }>();
  prepare(query: string): D1PreparedStatement { return new FakeStatement(this, query); }
  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { return []; }
}

test("OAuth client_secret_basic encoding form-encodes both credentials before Base64", () => {
  const header = createOAuthBasicAuthorization("client:id", "secret+with space");
  assert.equal(header.slice(0, 6), "Basic ");
  assert.equal(atob(header.slice(6)), "client%3Aid:secret%2Bwith+space");
});

const env = (): { DB: FakeD1; PAIRING_HMAC_KEY: string } => ({
  DB: new FakeD1(),
  PAIRING_HMAC_KEY: "unit-test-only-secret-not-for-production-32-bytes",
});

async function call(path: string, init: RequestInit = {}, bindings: Env = env()): Promise<Response> {
  return worker.fetch(new Request(`https://riftpulse.test${path}`, init), bindings);
}

test("health and version routes identify the V1 API and only the two V1 modules", async () => {
  const health = await call("/api/v1/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).apiVersion, "v1");
  const version = await call("/api/v1/version");
  assert.deepEqual((await version.json()).modules, ["chat", "bsr-song-request"]);
});

test("onboarding preferences are account-authenticated", async () => {
  const listing = await call("/api/v1/onboarding");
  assert.equal(listing.status, 503);
  assert.equal((await listing.json()).error.code, "auth_not_configured");

  const save = await call("/api/v1/onboarding", {
    method: "POST",
    headers: { origin: "https://riftpulse.test", "content-type": "application/json" },
    body: JSON.stringify({ completed: true }),
  });
  assert.equal(save.status, 503);
  assert.equal((await save.json()).error.code, "auth_not_configured");
});

test("release update history and read-state routes require an authenticated account", async () => {
  const listing = await call("/api/v1/updates");
  assert.equal(listing.status, 503);
  assert.equal((await listing.json()).error.code, "auth_not_configured");

  const marking = await call("/api/v1/updates/read", {
    method: "POST",
    headers: { origin: "https://riftpulse.test" },
  });
  assert.equal(marking.status, 503);
  assert.equal((await marking.json()).error.code, "auth_not_configured");
});

test("redirects insecure RiftPulse browser origins to HTTPS before auth or asset handling", async () => {
  const response = await worker.fetch(new Request("http://app.riftpulse.me/api/auth/sign-in/email?next=%2F"), env());
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://app.riftpulse.me/api/auth/sign-in/email?next=%2F");

  const aliasResponse = await worker.fetch(new Request("http://riftpulse.me/"), env());
  assert.equal(aliasResponse.status, 308);
  assert.equal(aliasResponse.headers.get("location"), "https://riftpulse.me/");
});

test("Railway API proxy preserves OAuth callback redirects for the browser", async () => {
  const bindings: Env = { ...env(), RAILWAY_API_URL: "https://riftpulse-api.test" };
  const originalFetch = globalThis.fetch;
  let observedRedirect: RequestRedirect | null = null;
  const expectedLocation = "https://app.riftpulse.me/?provider=twitch&status=connected";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const upstreamRequest = input instanceof Request ? input : new Request(input, init);
    observedRedirect = upstreamRequest.redirect;
    assert.equal(upstreamRequest.url, "https://riftpulse-api.test/api/v1/providers/twitch/callback?code=example");
    return new Response(null, { status: 303, headers: { location: expectedLocation } });
  };

  try {
    const response = await worker.fetch(new Request(
      "https://app.riftpulse.me/api/v1/providers/twitch/callback?code=example",
    ), bindings);
    assert.equal(observedRedirect, "manual");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), expectedLocation);
    assert.equal(response.headers.get("set-cookie"), null, "the rewritten Twitch flow does not depend on a browser state cookie");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Twitch homepage OAuth response is forwarded to the server callback before the SPA loads", async () => {
  const bindings: Env = { ...env(), RAILWAY_API_URL: "https://riftpulse-api.test" };
  const originalFetch = globalThis.fetch;
  const expectedLocation = "https://app.riftpulse.me/?provider=twitch&status=connected";
  let observedUrl = "";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const upstreamRequest = input instanceof Request ? input : new Request(input, init);
    observedUrl = upstreamRequest.url;
    assert.equal(upstreamRequest.method, "GET");
    assert.equal(upstreamRequest.redirect, "manual");
    return new Response(null, { status: 303, headers: { location: expectedLocation } });
  };

  try {
    const response = await worker.fetch(new Request(
      "https://app.riftpulse.me/?code=oauth-code&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&scope=user%3Aread%3Achat",
    ), bindings);
    assert.equal(observedUrl, "https://riftpulse-api.test/api/v1/providers/twitch/callback?code=oauth-code&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&scope=user%3Aread%3Achat");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), expectedLocation);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test("Railway API proxy preserves the JSON Twitch authorization handoff", async () => {
  const bindings: Env = { ...env(), RAILWAY_API_URL: "https://riftpulse-api.test" };
  const originalFetch = globalThis.fetch;
  let observedRedirect: RequestRedirect | null = null;
  const authorizeUrl = "https://id.twitch.tv/oauth2/authorize?client_id=test&response_type=code";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const upstreamRequest = input instanceof Request ? input : new Request(input, init);
    observedRedirect = upstreamRequest.redirect;
    assert.equal(upstreamRequest.method, "POST");
    assert.equal(upstreamRequest.url, "https://riftpulse-api.test/api/v1/providers/twitch/connect");
    assert.equal(upstreamRequest.headers.get("origin"), "https://app.riftpulse.me");
    return new Response(JSON.stringify({ authorizationUrl: authorizeUrl }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };

  try {
    const response = await worker.fetch(new Request(
      "https://app.riftpulse.me/api/v1/providers/twitch/connect",
      { method: "POST", headers: { origin: "https://app.riftpulse.me" } },
    ), bindings);
    assert.equal(observedRedirect, "manual");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authorizationUrl: authorizeUrl });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Quest can register a pairing challenge without a Unity upload handler or URL secrets", async () => {
  const bindings = env();
  const deviceId = "550e8400-e29b-41d4-a716-446655440000";
  const credential = "c".repeat(64);
  const response = await call("/api/v1/pairing/challenges/create", {
    method: "GET",
    headers: {
      "x-rp-pairing-code": "48126",
      "x-rp-device-credential": credential,
      "x-rp-device-id": deviceId,
      "x-rp-platform": "quest",
      "x-rp-game-version": "1.40.8_7379",
      "x-rp-mod-version": "0.1.20",
    },
  }, bindings);
  assert.equal(response.status, 201, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.status, "pending");
  assert.equal(typeof payload.challengeId, "string");
  assert.equal("code" in payload, false);
  assert.equal("deviceCredential" in payload, false);
  const saved = bindings.DB.challenges.get(payload.challengeId);
  assert.ok(saved);
  assert.equal(saved.device_id, deviceId);
  assert.notEqual(saved.code_digest, "48126");
  assert.notEqual(saved.device_credential_digest, credential);
});

test("Quest pairing header route rejects missing or malformed secure headers", async () => {
  const response = await call("/api/v1/pairing/challenges/create", {
    method: "GET",
    headers: { "x-rp-pairing-code": "12x45" },
  });
  assert.equal(response.status, 400);
});

test("Quest can save a module toggle with a device-authenticated header request", async () => {
  const bindings = env();
  const credential = "d".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  bindings.DB.deviceCredentialDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await call("/api/v1/device/settings/modules/chat", {
    method: "GET",
    headers: {
      authorization: "Bearer " + credential,
      "x-riftpulse-enabled": "false",
    },
  }, bindings);
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.moduleKey, "chat");
  assert.equal(payload.enabled, false);
  assert.equal(bindings.DB.moduleSettings.get("chat")?.enabled, 0);
});

test("native chat panel feed requires device auth and reports chat toggle plus viewer summary", async () => {
  const denied = await call("/api/v1/device/chat/panel");
  assert.equal(denied.status, 401);

  const bindings = env();
  const credential = "b".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  bindings.DB.deviceCredentialDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await call("/api/v1/device/chat/panel", {
    headers: { authorization: "Bearer " + credential },
  }, bindings);
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.chatEnabled, true);
  assert.deepEqual(payload.messages, []);
  assert.deepEqual(payload.viewers, {
    total: null,
    includedProviders: [],
    missingProviders: ["twitch", "youtube", "tiktok"],
    partial: false,
  });
});

test("Quest managed HTTP JSON PATCH saves a module preference with device authorization", async () => {
  const bindings = env();
  const credential = "f".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  bindings.DB.deviceCredentialDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await call("/api/v1/device/settings/modules/chat", {
    method: "PATCH",
    headers: {
      authorization: "Bearer " + credential,
      "content-type": "application/json",
    },
    body: JSON.stringify({ enabled: false }),
  }, bindings);
  assert.equal(response.status, 200, await response.clone().text());
  const payload = await response.json();
  assert.equal(payload.moduleKey, "chat");
  assert.equal(payload.enabled, false);
  assert.equal(bindings.DB.moduleSettings.get("chat")?.enabled, 0);
});

test("Quest module toggle header route rejects unauthenticated or malformed input", async () => {
  const denied = await call("/api/v1/device/settings/modules/chat", {
    method: "GET",
    headers: { "x-riftpulse-enabled": "true" },
  });
  assert.equal(denied.status, 401);
  const bindings = env();
  const credential = "e".repeat(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  bindings.DB.deviceCredentialDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const malformed = await call("/api/v1/device/settings/modules/chat", {
    method: "GET",
    headers: { authorization: "Bearer " + credential, "x-riftpulse-enabled": "maybe" },
  }, bindings);
  assert.equal(malformed.status, 400);
});

test("pairing challenge stores a digest and never returns the raw code", async () => {
  const bindings = env();
  const response = await call("/api/v1/pairing/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "04271",
      deviceCredential: "a".repeat(64),
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      platform: "quest",
      gameVersion: "1.40.8_7379",
      modVersion: "0.1.0-dev",
    }),
  }, bindings);
  assert.equal(response.status, 201);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.status, "pending");
  assert.equal(typeof payload.challengeId, "string");
  assert.equal("code" in payload, false);
  const saved = bindings.DB.challenges.get(payload.challengeId as string);
  assert.ok(saved);
  assert.notEqual(saved.code_digest, "04271");
  assert.match(saved.code_digest ?? "", /^[0-9a-f]{64}$/);
  assert.match(saved.device_credential_digest ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(saved.device_credential_digest, "a".repeat(64));
  assert.equal("deviceCredential" in payload, false);

  const statusResponse = await call(`/api/v1/pairing/challenges/${payload.challengeId}`, {}, bindings);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).status, "pending");
});

test("Quest can resume pending and claimed pairing sessions after a restart", async () => {
  const bindings = env();
  const deviceId = "550e8400-e29b-41d4-a716-446655440000";
  const credential = "a".repeat(64);
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  const credentialDigest = Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, "0")).join("");

  const created = await call("/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "48261", deviceCredential: credential, deviceId, platform: "quest",
      gameVersion: "1.40.8_7379", modVersion: "0.1.25",
    }),
  }, bindings);
  assert.equal(created.status, 201);
  const createdPayload = await created.json() as { challengeId: string };

  const resumeBody = JSON.stringify({ deviceId, deviceCredential: credential });
  const pending = await call("/api/v1/pairing/resume", {
    method: "POST", headers: { "content-type": "application/json" }, body: resumeBody,
  }, bindings);
  assert.equal(pending.status, 200, await pending.clone().text());
  assert.deepEqual(await pending.json(), {
    challengeId: createdPayload.challengeId,
    status: "pending",
    expiresAt: bindings.DB.challenges.get(createdPayload.challengeId)?.expires_at,
    pollAfterMs: 1500,
  });

  const saved = bindings.DB.challenges.get(createdPayload.challengeId)!;
  saved.status = "claimed";
  saved.device_credential_digest = null;
  saved.claimed_at = new Date().toISOString();
  bindings.DB.deviceCredentialDigest = credentialDigest;
  const claimed = await call("/api/v1/pairing/resume", {
    method: "POST", headers: { "content-type": "application/json" }, body: resumeBody,
  }, bindings);
  assert.equal(claimed.status, 200, await claimed.clone().text());
  assert.equal((await claimed.json()).status, "claimed");

  const nextCreated = await call("/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "48262", deviceCredential: credential, deviceId, platform: "quest",
      gameVersion: "1.40.8_7379", modVersion: "0.1.25",
    }),
  }, bindings);
  assert.equal(nextCreated.status, 201);
  const nextPayload = await nextCreated.json() as { challengeId: string };
  const latest = await call("/api/v1/pairing/resume", {
    method: "POST", headers: { "content-type": "application/json" }, body: resumeBody,
  }, bindings);
  assert.equal(latest.status, 200);
  const latestPayload = await latest.json();
  assert.equal(latestPayload.status, "pending");
  assert.equal(latestPayload.challengeId, nextPayload.challengeId);

  const denied = await call("/api/v1/pairing/resume", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, deviceCredential: "f".repeat(64) }),
  }, bindings);
  assert.equal(denied.status, 404);
});

test("rejects an active code collision and caps active challenges per device", async () => {
  const bindings = env();
  const baseBody = {
    code: "10001",
    deviceCredential: "b".repeat(64),
    deviceId: "550e8400-e29b-41d4-a716-446655440000",
    platform: "quest",
    gameVersion: "1.40.8_7379",
    modVersion: "0.1.0-dev",
  };
  const first = await call("/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseBody),
  }, bindings);
  assert.equal(first.status, 201);

  const collision = await call("/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(baseBody),
  }, bindings);
  assert.equal(collision.status, 409);

  for (const code of ["10002", "10003"]) {
    const response = await call("/api/v1/pairing/challenges", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...baseBody, code }),
    }, bindings);
    assert.equal(response.status, 201);
  }
  const limited = await call("/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...baseBody, code: "10004" }),
  }, bindings);
  assert.equal(limited.status, 429);
});

test("rejects invalid pairing code and fails closed when auth is not configured", async () => {
  const invalid = await call("/api/v1/pairing/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "12x45",
      deviceId: "550e8400-e29b-41d4-a716-446655440000",
      platform: "quest",
      gameVersion: "1.40.8_7379",
      modVersion: "0.1.0-dev",
    }),
  });
  assert.equal(invalid.status, 400);
  const claim = await call("/api/v1/pairing/claim", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://riftpulse.test" },
    body: JSON.stringify({ code: "04271" }),
  }, { ...env(), APP_BASE_URL: "https://riftpulse.test", TRUSTED_ORIGINS: "https://riftpulse.test" });
  assert.equal(claim.status, 503);
});

test("YouTube live-chat polling fails closed when authentication is not configured", async () => {
  const response = await call("/api/v1/providers/youtube/poll", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://riftpulse.test" }, body: "{}",
  }, { ...env(), APP_BASE_URL: "https://riftpulse.test", TRUSTED_ORIGINS: "https://riftpulse.test" });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error.code, "auth_not_configured");
});

test("requires pairing configuration and rejects unknown API routes", async () => {
  const unconfigured = await call("/api/v1/pairing/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "04271" }),
  }, { DB: new FakeD1() });
  assert.equal(unconfigured.status, 503);
  const missing = await call("/api/v1/not-a-route");
  assert.equal(missing.status, 404);
});


test("private TikTok account discovery requires the bridge secret", async () => {
  const secret = "unit-test-connector-secret-that-is-at-least-32-bytes";
  const bindings = { ...env(), TIKTOK_CONNECTOR_INGEST_SECRET: secret };
  const denied = await call("/api/v1/internal/tiktok/accounts", {}, bindings);
  assert.equal(denied.status, 401);
  const allowed = await call("/api/v1/internal/tiktok/accounts", {
    headers: { authorization: "Bearer " + secret },
  }, bindings);
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).accounts, []);
});


test("private TikTok connection status route requires the bridge secret", async () => {
  const secret = "unit-test-connector-secret-that-is-at-least-32-bytes";
  const bindings = { ...env(), TIKTOK_CONNECTOR_INGEST_SECRET: secret };
  const denied = await call("/api/v1/internal/tiktok/status", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: "acct", username: "creator", status: "connected" }),
  }, bindings);
  assert.equal(denied.status, 401);
});

test("in-game chat feed requires a valid paired-device credential", async () => {
  const bindings = env();
  const credential = "a".repeat(64);
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  bindings.DB.deviceCredentialDigest = Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, "0")).join("");

  const denied = await call("/api/v1/device/chat/messages", {}, bindings);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).error.code, "device_authentication_required");

  const response = await call("/api/v1/device/chat/messages", {
    headers: { authorization: "Bearer " + credential },
  }, bindings);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, []);
});