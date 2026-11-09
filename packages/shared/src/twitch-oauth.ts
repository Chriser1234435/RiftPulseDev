import type { D1Database } from "../../../src/env.ts";
import { digestOAuthState, createOAuthState } from "./oauth-state.ts";
import { persistProviderTokens } from "./provider-connections.ts";

export const TWITCH_OAUTH_SCOPES = [
  "user:read:chat",
  "user:bot",
  "channel:bot",
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
] as const;

export type TwitchOAuthFailure =
  | "state_invalid_or_expired"
  | "authorization_denied"
  | "authorization_code_missing"
  | "token_exchange_failed"
  | "token_response_invalid"
  | "token_validation_failed"
  | "scope_mismatch"
  | "token_persistence_failed"
  | "storage_failed";

export type TwitchOAuthResult =
  | { ok: true; accountId: string; displayName: string; externalAccountId: string }
  | { ok: false; reason: TwitchOAuthFailure; stage: string };

export interface BeginTwitchOAuthInput {
  db: D1Database;
  accountId: string;
  clientId: string;
  redirectUri: string;
  now?: Date;
}

/**
 * Creates a server-side, digest-only, single-use OAuth state and an authorization URL.
 * No browser state cookie is required; the callback claims the state atomically in D1.
 */
export async function beginTwitchOAuth(input: BeginTwitchOAuthInput): Promise<string> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();

  const cleanup = await input.db.prepare(
    "DELETE FROM provider_oauth_states WHERE expires_at <= ?",
  ).bind(nowIso).run();
  if (!cleanup.success) throw new Error("oauth_state_cleanup_failed");

  const state = createOAuthState();
  const digest = await digestOAuthState(state);
  const inserted = await input.db.prepare(
    "INSERT INTO provider_oauth_states (state_digest, account_id, provider, created_at, expires_at, consumed_at) VALUES (?, ?, 'twitch', ?, ?, NULL)",
  ).bind(digest, input.accountId, nowIso, expiresAt).run();
  if (!inserted.success) throw new Error("oauth_state_insert_failed");

  const authorizationUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authorizationUrl.searchParams.set("client_id", input.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", TWITCH_OAUTH_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  return authorizationUrl.toString();
}

export interface CompleteTwitchOAuthInput {
  db: D1Database;
  state: string | null;
  code: string | null;
  providerError: string | null;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  redirectUri: string;
  now?: Date;
  fetcher?: typeof fetch;
}

/**
 * Consumes the callback state exactly once, exchanges the code, validates the
 * resulting user token with Twitch, and persists only encrypted token material.
 */
export async function completeTwitchOAuth(input: CompleteTwitchOAuthInput): Promise<TwitchOAuthResult> {
  const fail = (reason: TwitchOAuthFailure, stage: string): TwitchOAuthResult => ({ ok: false, reason, stage });
  if (!input.state || !/^[a-f0-9]{64}$/i.test(input.state)) {
    return fail("state_invalid_or_expired", "validate_state");
  }

  let accountId: string | null;
  try {
    const digest = await digestOAuthState(input.state);
    const nowIso = (input.now ?? new Date()).toISOString();
    const claimed = await input.db.prepare(
      "UPDATE provider_oauth_states SET consumed_at = ? WHERE state_digest = ? AND provider = 'twitch' AND consumed_at IS NULL AND expires_at > ? RETURNING account_id",
    ).bind(nowIso, digest, nowIso).first<{ account_id: string }>();
    accountId = claimed?.account_id ?? null;
  } catch {
    return fail("storage_failed", "claim_state");
  }
  if (!accountId) return fail("state_invalid_or_expired", "claim_state");
  if (input.providerError) return fail("authorization_denied", "provider_denied");
  if (!input.code || input.code.length > 2048) return fail("authorization_code_missing", "read_code");

  const fetcher = input.fetcher ?? fetch;
  let token: Record<string, unknown>;
  try {
    const tokenResponse = await fetcher("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
    });
    if (!tokenResponse.ok) return fail("token_exchange_failed", "exchange_code");
    const payload: unknown = await tokenResponse.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return fail("token_response_invalid", "parse_token_response");
    }
    token = payload as Record<string, unknown>;
  } catch {
    return fail("token_exchange_failed", "exchange_code");
  }

  if (typeof token.access_token !== "string" || !token.access_token
    || typeof token.refresh_token !== "string" || !token.refresh_token
    || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    return fail("token_response_invalid", "validate_token_response");
  }

  let validation: Record<string, unknown>;
  try {
    const validationResponse = await fetcher("https://id.twitch.tv/oauth2/validate", {
      headers: { authorization: "OAuth " + token.access_token, accept: "application/json" },
    });
    if (!validationResponse.ok) return fail("token_validation_failed", "validate_token");
    const payload: unknown = await validationResponse.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return fail("token_validation_failed", "parse_validation");
    }
    validation = payload as Record<string, unknown>;
  } catch {
    return fail("token_validation_failed", "validate_token");
  }

  const scopes = Array.isArray(validation.scopes) && validation.scopes.every(scope => typeof scope === "string")
    ? validation.scopes as string[] : [];
  if (validation.client_id !== input.clientId
    || typeof validation.user_id !== "string" || !validation.user_id
    || typeof validation.login !== "string" || !validation.login) {
    return fail("token_validation_failed", "validate_identity");
  }
  const missingScopes = TWITCH_OAUTH_SCOPES.filter(scope => !scopes.includes(scope));
  if (missingScopes.length > 0) return fail("scope_mismatch", "validate_scopes");

  const saved = await persistProviderTokens(input.db, {
    accountId,
    provider: "twitch",
    externalAccountId: validation.user_id,
    displayName: validation.login,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date((input.now ?? new Date()).getTime() + token.expires_in * 1000).toISOString(),
    scopes,
    now: input.now,
  }, input.encryptionKey);
  if (!saved.ok) return fail("token_persistence_failed", "persist_tokens");

  // Chat/EventSub setup is a separate step. A health-row failure must not undo
  // an already-saved Twitch authorization or show the account as disconnected.
  try {
    const health = await input.db.prepare(
      "INSERT INTO integration_health (id, account_id, provider, status, viewer_count, observed_at, detail_code, viewer_count_observed_at) VALUES (?, ?, 'twitch', 'degraded', NULL, ?, 'eventsub_subscription_pending', NULL) ON CONFLICT(account_id, provider) DO UPDATE SET status = 'degraded', viewer_count = NULL, observed_at = excluded.observed_at, detail_code = 'eventsub_subscription_pending', viewer_count_observed_at = NULL",
    ).bind(crypto.randomUUID(), accountId, (input.now ?? new Date()).toISOString()).run();
    if (!health.success) console.error("twitch_oauth_health_status_write_failed");
  } catch {
    console.error("twitch_oauth_health_status_write_failed");
  }

  return {
    ok: true,
    accountId,
    displayName: validation.login,
    externalAccountId: validation.user_id,
  };
}
