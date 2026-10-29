import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "../../src/env.ts";
import {
  disconnectProvider, persistProviderTokens, readProviderTokens,
} from "../../packages/shared/src/provider-connections.ts";

class FakeStatement implements D1PreparedStatement {
  values: unknown[] = [];
  private readonly db: FakeDatabase;
  private readonly query: string;
  constructor(db: FakeDatabase, query: string) { this.db = db; this.query = query; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; this.db.lastQuery = this.query; this.db.lastValues = values; return this; }
  async first<T>(): Promise<T | null> { return this.db.firstResult as T | null; }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
  async run<T>(): Promise<D1Result<T>> { return this.db.runResult; }
}

class FakeDatabase implements D1Database {
  lastQuery = "";
  lastValues: unknown[] = [];
  firstResult: unknown = null;
  runResult: D1Result = { success: true, meta: { changes: 1 } };
  prepare(query: string): D1PreparedStatement { return new FakeStatement(this, query); }
  async batch<T>(): Promise<D1Result<T>[]> { return []; }
}

test("provider token persistence stores ciphertext and can decrypt it for the owner", async () => {
  const db = new FakeDatabase();
  const key = randomBytes(32).toString("base64");
  const accessToken = "plain-access-token-do-not-store";
  const refreshToken = "plain-refresh-token-do-not-store";
  const saved = await persistProviderTokens(db, {
    accountId: "acct-1", provider: "twitch", externalAccountId: "channel-1",
    displayName: "Streamer", accessToken, refreshToken, tokenExpiresAt: "2026-10-29T13:00:00.000Z",
    scopes: ["user:read:chat"], now: new Date("2026-10-29T12:00:00.000Z"),
  }, key);
  assert.deepEqual(saved, { ok: true });
  assert.match(db.lastQuery, /access_token_ciphertext/);
  assert.match(db.lastQuery, /refresh_token_ciphertext/);
  assert.equal(JSON.stringify(db.lastValues).includes(accessToken), false);
  assert.equal(JSON.stringify(db.lastValues).includes(refreshToken), false);

  db.firstResult = {
    accessTokenCiphertext: db.lastValues[5],
    refreshTokenCiphertext: db.lastValues[6],
    tokenExpiresAt: db.lastValues[7],
    scopesJson: db.lastValues[8],
    status: "connected",
  };
  const read = await readProviderTokens(db, "acct-1", "twitch", key);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.accessToken, accessToken);
    assert.equal(read.refreshToken, refreshToken);
    assert.deepEqual(read.scopes, ["user:read:chat"]);
  }
});

test("provider disconnect clears stored token ciphertext", async () => {
  const db = new FakeDatabase();
  assert.equal(await disconnectProvider(db, "acct-1", "twitch", new Date("2026-10-29T12:00:00Z")), true);
  assert.match(db.lastQuery, /access_token_ciphertext = NULL/);
  assert.match(db.lastQuery, /refresh_token_ciphertext = NULL/);
  assert.deepEqual(db.lastValues.slice(1), ["acct-1", "twitch"]);
});

test("provider token storage fails closed for invalid keys or database errors", async () => {
  const db = new FakeDatabase();
  const input = {
    accountId: "acct-1", provider: "kick" as const, externalAccountId: "channel-1",
    displayName: null, accessToken: "access", refreshToken: null, tokenExpiresAt: null,
    scopes: [], now: new Date("2026-10-29T12:00:00Z"),
  };
  assert.deepEqual(await persistProviderTokens(db, input, "short"), { ok: false, reason: "encryption_error" });
  db.runResult = { success: false };
  assert.deepEqual(await persistProviderTokens(db, input, randomBytes(32).toString("base64")), { ok: false, reason: "database_error" });
  db.firstResult = { status: "connected", accessTokenCiphertext: "not-an-envelope", refreshTokenCiphertext: null, tokenExpiresAt: null, scopesJson: "[]"};
  assert.deepEqual(await readProviderTokens(db, "acct-1", "kick", randomBytes(32).toString("base64")), { ok: false, reason: "token_decryption_failed" });
});
