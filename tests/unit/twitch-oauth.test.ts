import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "../../src/env.ts";
import { decryptProviderToken } from "../../packages/shared/src/provider-token-vault.ts";
import { digestOAuthState } from "../../packages/shared/src/oauth-state.ts";
import {
  beginTwitchOAuth,
  completeTwitchOAuth,
  TWITCH_OAUTH_SCOPES,
} from "../../packages/shared/src/twitch-oauth.ts";

type OAuthStateRow = {
  state_digest: string;
  account_id: string;
  provider: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

type ConnectionRow = {
  account_id: string;
  provider: string;
  external_account_id: string;
  display_name: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  token_expires_at: string;
  scopes_json: string;
  status: string;
};

class MemoryOAuthDb implements D1Database {
  states: OAuthStateRow[] = [];
  connections: ConnectionRow[] = [];
  healthRows: Array<{ account_id: string; provider: string; status: string; detail_code: string }> = [];

  prepare(sql: string): D1PreparedStatement {
    return new MemoryOAuthStatement(this, sql);
  }

  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return [];
  }
}

class MemoryOAuthStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly db: MemoryOAuthDb;
  private readonly sql: string;

  constructor(db: MemoryOAuthDb, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const q = this.sql.toLowerCase();
    if (q.startsWith("update provider_oauth_states set consumed_at")) {
      const [consumedAt, digest, now] = this.values as [string, string, string];
      const row = this.db.states.find(item =>
        item.state_digest === digest
        && item.provider === "twitch"
        && item.consumed_at === null
        && item.expires_at > now
      );
      if (!row) return null;
      row.consumed_at = consumedAt;
      return { account_id: row.account_id } as T;
    }
    return null;
  }

  async run<T>(): Promise<D1Result<T>> {
    const q = this.sql.toLowerCase();
    if (q.startsWith("delete from provider_oauth_states")) {
      const [now] = this.values as [string];
      this.db.states = this.db.states.filter(row => row.expires_at > now);
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith("insert into provider_oauth_states")) {
      const [state_digest, account_id, created_at, expires_at] =
        this.values as [string, string, string, string];
      this.db.states.push({
        state_digest, account_id, provider: "twitch", created_at, expires_at, consumed_at: null,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith("insert into provider_connections")) {
      const [
        , account_id, provider, external_account_id, display_name,
        access_token_ciphertext, refresh_token_ciphertext, token_expires_at, scopes_json,
      ] = this.values as [string, string, string, string, string, string, string, string, string, string, string];
      const row: ConnectionRow = {
        account_id, provider, external_account_id, display_name,
        access_token_ciphertext, refresh_token_ciphertext, token_expires_at, scopes_json,
        status: "connected",
      };
      const existing = this.db.connections.findIndex(item => item.account_id === account_id && item.provider === provider);
      if (existing >= 0) this.db.connections[existing] = row;
      else this.db.connections.push(row);
      return { success: true, meta: { changes: 1 } };
    }

    if (q.startsWith("insert into integration_health")) {
      const [, account_id] = this.values as [string, string, string];
      this.db.healthRows = this.db.healthRows.filter(item => item.account_id !== account_id || item.provider !== "twitch");
      this.db.healthRows.push({
        account_id, provider: "twitch", status: "degraded", detail_code: "eventsub_subscription_pending",
      });
      return { success: true, meta: { changes: 1 } };
    }

    return { success: true, meta: { changes: 0 } };
  }

  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }
}

const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const clientId = "riftpulse-test-client";
const clientSecret = "test-client-secret";
const redirectUri = "https://app.riftpulse.me/api/v1/providers/twitch/callback";
const now = new Date("2026-11-09T18:00:00.000Z");

function mockTwitch(fetchOptions: {
  tokenStatus?: number;
  validateStatus?: number;
  scopes?: string[];
} = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        scope: [...TWITCH_OAUTH_SCOPES],
      }), { status: fetchOptions.tokenStatus ?? 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("/oauth2/validate")) {
      return new Response(JSON.stringify({
        client_id: clientId,
        user_id: "123456",
        login: "riftpulse_tester",
        scopes: fetchOptions.scopes ?? [...TWITCH_OAUTH_SCOPES],
      }), { status: fetchOptions.validateStatus ?? 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected Twitch URL");
  };
  return { fetcher, requests };
}

test("Twitch OAuth start stores a digest and builds the exact authorization redirect", async () => {
  const db = new MemoryOAuthDb();
  const authorizationUrl = await beginTwitchOAuth({
    db, accountId: "account-1", clientId, redirectUri, now,
  });
  const url = new URL(authorizationUrl);

  assert.equal(url.origin, "https://id.twitch.tv");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...TWITCH_OAUTH_SCOPES]);

  const state = url.searchParams.get("state");
  assert.match(state ?? "", /^[a-f0-9]{64}$/);
  assert.equal(db.states.length, 1);
  assert.equal(db.states[0].account_id, "account-1");
  assert.equal(db.states[0].state_digest, await digestOAuthState(state!));
  assert.notEqual(db.states[0].state_digest, state);
});

test("Twitch OAuth callback succeeds without relying on a browser state cookie", async () => {
  const db = new MemoryOAuthDb();
  const state = "a".repeat(64);
  db.states.push({
    state_digest: await digestOAuthState(state),
    account_id: "account-2",
    provider: "twitch",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    consumed_at: null,
  });
  const twitch = mockTwitch();

  const result = await completeTwitchOAuth({
    db, state, code: "one-time-authorization-code", providerError: null,
    clientId, clientSecret, encryptionKey, redirectUri, now, fetcher: twitch.fetcher,
  });

  assert.deepEqual(result, {
    ok: true, accountId: "account-2", displayName: "riftpulse_tester", externalAccountId: "123456",
  });
  assert.equal(db.states[0].consumed_at, now.toISOString());
  assert.equal(db.connections.length, 1);
  assert.equal(db.connections[0].status, "connected");
  assert.equal(db.connections[0].display_name, "riftpulse_tester");
  assert.match(db.connections[0].access_token_ciphertext, /^v1\./);
  assert.equal(await decryptProviderToken(db.connections[0].access_token_ciphertext, encryptionKey), "test-access-token");
  assert.equal(await decryptProviderToken(db.connections[0].refresh_token_ciphertext, encryptionKey), "test-refresh-token");
  assert.equal(db.healthRows[0].detail_code, "eventsub_subscription_pending");
  assert.equal(twitch.requests.length, 2);
  assert.deepEqual(twitch.requests.map(item => item.url), [
    "https://id.twitch.tv/oauth2/token",
    "https://id.twitch.tv/oauth2/validate",
  ]);
  const tokenBody = twitch.requests[0].init?.body as URLSearchParams;
  assert.equal(tokenBody.get("redirect_uri"), redirectUri);
  assert.equal(tokenBody.get("code"), "one-time-authorization-code");
});

test("Twitch OAuth callback rejects replayed state and never exchanges the code twice", async () => {
  const db = new MemoryOAuthDb();
  const state = "b".repeat(64);
  db.states.push({
    state_digest: await digestOAuthState(state),
    account_id: "account-3",
    provider: "twitch",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    consumed_at: null,
  });
  const twitch = mockTwitch();
  const input = {
    db, state, code: "single-use-code", providerError: null,
    clientId, clientSecret, encryptionKey, redirectUri, now, fetcher: twitch.fetcher,
  };

  assert.equal((await completeTwitchOAuth(input)).ok, true);
  const replay = await completeTwitchOAuth(input);
  assert.deepEqual(replay, { ok: false, reason: "state_invalid_or_expired", stage: "claim_state" });
  assert.equal(twitch.requests.length, 2);
});

test("Twitch OAuth callback reports missing permissions and does not save an incomplete connection", async () => {
  const db = new MemoryOAuthDb();
  const state = "c".repeat(64);
  db.states.push({
    state_digest: await digestOAuthState(state),
    account_id: "account-4",
    provider: "twitch",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    consumed_at: null,
  });
  const missingScopes = TWITCH_OAUTH_SCOPES.filter(scope => scope !== "bits:read");
  const twitch = mockTwitch({ scopes: [...missingScopes] });

  const result = await completeTwitchOAuth({
    db, state, code: "code-with-missing-scope", providerError: null,
    clientId, clientSecret, encryptionKey, redirectUri, now, fetcher: twitch.fetcher,
  });

  assert.deepEqual(result, { ok: false, reason: "scope_mismatch", stage: "validate_scopes" });
  assert.equal(db.states[0].consumed_at, now.toISOString());
  assert.equal(db.connections.length, 0);
});

test("Twitch OAuth callback consumes state when token exchange fails", async () => {
  const db = new MemoryOAuthDb();
  const state = "d".repeat(64);
  db.states.push({
    state_digest: await digestOAuthState(state),
    account_id: "account-5",
    provider: "twitch",
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    consumed_at: null,
  });
  const twitch = mockTwitch({ tokenStatus: 400 });

  const result = await completeTwitchOAuth({
    db, state, code: "rejected-code", providerError: null,
    clientId, clientSecret, encryptionKey, redirectUri, now, fetcher: twitch.fetcher,
  });

  assert.deepEqual(result, { ok: false, reason: "token_exchange_failed", stage: "exchange_code" });
  assert.equal(db.states[0].consumed_at, now.toISOString());
  assert.equal(db.connections.length, 0);
});
