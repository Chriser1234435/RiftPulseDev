import assert from "node:assert/strict";
import test from "node:test";
import worker from "../../src/index.ts";
import type { D1Database, D1PreparedStatement, D1Result, Env } from "../../src/env.ts";

type ChallengeRow = {
  id: string; device_id: string; platform: "pcvr" | "quest"; game_version: string;
  mod_version: string; code_digest: string | null; status: string;
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
    if (q.includes("select status, expires_at, claimed_at from pairing_challenges")) {
      const [id] = this.values as [string];
      const found = this.db.challenges.get(id);
      return found ? ({ status: found.status, expires_at: found.expires_at, claimed_at: found.claimed_at } as T) : null;
    }
    return null;
  }
  async run<T>(): Promise<D1Result<T>> {
    const q = this.query.toLowerCase();
    if (q.includes("insert into pairing_challenges")) {
      const [id, device_id, platform, game_version, mod_version, code_digest, created_at, expires_at] =
        this.values as [string, string, "pcvr" | "quest", string, string, string, string, string];
      this.db.challenges.set(id, {
        id, device_id, platform, game_version, mod_version, code_digest, status: "pending",
        created_at, expires_at, claimed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (q.startsWith("update pairing_challenges")) {
      return { success: true, meta: { changes: 0 } };
    }
    return { success: true, meta: { changes: 0 } };
  }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
}

class FakeD1 implements D1Database {
  readonly challenges = new Map<string, ChallengeRow>();
  prepare(query: string): D1PreparedStatement { return new FakeStatement(this, query); }
  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> { return []; }
}

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

test("pairing challenge stores a digest and never returns the raw code", async () => {
  const bindings = env();
  const response = await call("/api/v1/pairing/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "04271",
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

  const statusResponse = await call(`/api/v1/pairing/challenges/${payload.challengeId}`, {}, bindings);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).status, "pending");
});

test("rejects an active code collision and caps active challenges per device", async () => {
  const bindings = env();
  const baseBody = {
    code: "10001",
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
