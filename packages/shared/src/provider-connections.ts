import type { ProviderKey } from "../../contracts/src/v1.ts";
import type { D1Database } from "../../../src/env.ts";
import { decryptProviderToken, encryptProviderToken } from "./provider-token-vault.ts";

export interface ProviderTokenWriteInput {
  accountId: string;
  provider: ProviderKey;
  externalAccountId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  now?: Date;
}

export type ProviderTokenWriteResult =
  | { ok: true }
  | { ok: false; reason: "invalid_input" | "encryption_error" | "database_error" };

export async function persistProviderTokens(
  db: D1Database,
  input: ProviderTokenWriteInput,
  encryptionKey: string,
): Promise<ProviderTokenWriteResult> {
  if (!input.accountId || input.accountId.length > 128
    || !input.externalAccountId || input.externalAccountId.length > 128
    || (input.displayName !== null && input.displayName.length > 160)
    || !Array.isArray(input.scopes) || input.scopes.length > 50
    || input.scopes.some(scope => typeof scope !== "string" || !scope || scope.length > 128)
    || (input.tokenExpiresAt !== null && !Number.isFinite(Date.parse(input.tokenExpiresAt)))) {
    return { ok: false, reason: "invalid_input" };
  }
  let accessTokenCiphertext: string;
  let refreshTokenCiphertext: string | null = null;
  try {
    accessTokenCiphertext = await encryptProviderToken(input.accessToken, encryptionKey);
    if (input.refreshToken) refreshTokenCiphertext = await encryptProviderToken(input.refreshToken, encryptionKey);
  } catch {
    return { ok: false, reason: "encryption_error" };
  }
  const now = (input.now ?? new Date()).toISOString();
  try {
    const result = await db.prepare(
      `INSERT INTO provider_connections
       (id, account_id, provider, external_account_id, display_name, access_token_ciphertext,
        refresh_token_ciphertext, token_expires_at, scopes_json, status, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?)
       ON CONFLICT(account_id, provider) DO UPDATE SET
        external_account_id = excluded.external_account_id,
        display_name = excluded.display_name,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        token_expires_at = excluded.token_expires_at,
        scopes_json = excluded.scopes_json,
        status = 'connected',
        connected_at = COALESCE(provider_connections.connected_at, excluded.connected_at),
        updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), input.accountId, input.provider, input.externalAccountId, input.displayName,
      accessTokenCiphertext, refreshTokenCiphertext, input.tokenExpiresAt, JSON.stringify(input.scopes), now, now,
    ).run();
    return result.success ? { ok: true } : { ok: false, reason: "database_error" };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

export type ProviderTokenReadResult =
  | { ok: true; accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null; scopes: string[]; externalAccountId: string; displayName: string | null }
  | { ok: false; reason: "not_connected" | "database_error" | "token_decryption_failed" };

export async function readProviderTokens(
  db: D1Database,
  accountId: string,
  provider: ProviderKey,
  encryptionKey: string,
): Promise<ProviderTokenReadResult> {
  let row: {
    accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null;
    tokenExpiresAt: string | null; scopesJson: string; status: string; externalAccountId: string | null; displayName: string | null;
  } | null;
  try {
    row = await db.prepare(
      "SELECT access_token_ciphertext AS accessTokenCiphertext, refresh_token_ciphertext AS refreshTokenCiphertext, token_expires_at AS tokenExpiresAt, scopes_json AS scopesJson, status, external_account_id AS externalAccountId, display_name AS displayName FROM provider_connections WHERE account_id = ? AND provider = ? LIMIT 1",
    ).bind(accountId, provider).first<{
      accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null;
      tokenExpiresAt: string | null; scopesJson: string; status: string; externalAccountId: string | null; displayName: string | null;
    }>();
  } catch {
    return { ok: false, reason: "database_error" };
  }
  if (!row || row.status !== "connected" || !row.accessTokenCiphertext) return { ok: false, reason: "not_connected" };
  let scopes: unknown = [];
  try { scopes = JSON.parse(row.scopesJson); } catch { scopes = []; }
  if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string")) scopes = [];
  try {
    const accessToken = await decryptProviderToken(row.accessTokenCiphertext, encryptionKey);
    const refreshToken = row.refreshTokenCiphertext
      ? await decryptProviderToken(row.refreshTokenCiphertext, encryptionKey) : null;
    return {
      ok: true, accessToken, refreshToken, tokenExpiresAt: row.tokenExpiresAt,
      scopes: scopes as string[], externalAccountId: row.externalAccountId ?? "", displayName: row.displayName,
    };
  } catch {
    return { ok: false, reason: "token_decryption_failed" };
  }
}

export type EnsureFreshTwitchTokenResult =
  | { ok: true; accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null; scopes: string[]; externalAccountId: string }
  | { ok: false; reason: "not_connected" | "database_error" | "token_decryption_failed" | "missing_refresh_token" | "refresh_failed" | "token_validation_failed" | "storage_failed" };

/**
 * Validates the saved Twitch token, refreshes it when it is expired or within five minutes of expiry,
 * validates the rotated token, then persists the new token pair encrypted.
 */
export async function ensureFreshTwitchProviderTokens(
  db: D1Database,
  accountId: string,
  clientId: string,
  clientSecret: string,
  encryptionKey: string,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<EnsureFreshTwitchTokenResult> {
  const current = await readProviderTokens(db, accountId, "twitch", encryptionKey);
  if (!current.ok) return current;
  if (!current.externalAccountId || !clientId || !clientSecret) return { ok: false, reason: "token_validation_failed" };

  const requiredScopes = ["user:read:chat", "user:bot", "channel:bot"];
  const validate = async (accessToken: string) => {
    try {
      const response = await fetcher("https://id.twitch.tv/oauth2/validate", {
        headers: { authorization: "OAuth " + accessToken, accept: "application/json" },
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const data = payload as Record<string, unknown>;
      const scopes = Array.isArray(data.scopes) && data.scopes.every(scope => typeof scope === "string")
        ? data.scopes as string[] : null;
      if (data.client_id !== clientId || data.user_id !== current.externalAccountId || !scopes
        || !requiredScopes.every(scope => scopes.includes(scope))
        || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) return null;
      return { scopes, expiresIn: data.expires_in, login: typeof data.login === "string" ? data.login : current.displayName };
    } catch {
      return null;
    }
  };

  const currentValidation = await validate(current.accessToken);
  if (currentValidation && currentValidation.expiresIn > 300) {
    return {
      ok: true, accessToken: current.accessToken, refreshToken: current.refreshToken,
      tokenExpiresAt: new Date(now.getTime() + currentValidation.expiresIn * 1000).toISOString(),
      scopes: currentValidation.scopes, externalAccountId: current.externalAccountId,
    };
  }
  if (!current.refreshToken) return { ok: false, reason: "missing_refresh_token" };

  try {
    const response = await fetcher("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      }),
    });
    if (!response.ok) return { ok: false, reason: "refresh_failed" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "refresh_failed" };
    const token = payload as Record<string, unknown>;
    if (typeof token.access_token !== "string" || !token.access_token
      || typeof token.refresh_token !== "string" || !token.refresh_token
      || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      return { ok: false, reason: "refresh_failed" };
    }

    const validation = await validate(token.access_token);
    if (!validation) return { ok: false, reason: "token_validation_failed" };
    const tokenExpiresAt = new Date(now.getTime() + token.expires_in * 1000).toISOString();
    const saved = await persistProviderTokens(db, {
      accountId, provider: "twitch", externalAccountId: current.externalAccountId,
      displayName: validation.login, accessToken: token.access_token, refreshToken: token.refresh_token,
      tokenExpiresAt, scopes: validation.scopes, now,
    }, encryptionKey);
    if (!saved.ok) return { ok: false, reason: "storage_failed" };
    return {
      ok: true, accessToken: token.access_token, refreshToken: token.refresh_token,
      tokenExpiresAt, scopes: validation.scopes, externalAccountId: current.externalAccountId,
    };
  } catch {
    return { ok: false, reason: "refresh_failed" };
  }
}

export async function disconnectProvider(
  db: D1Database,
  accountId: string,
  provider: ProviderKey,
  now = new Date(),
): Promise<boolean> {
  try {
    const result = await db.prepare(
      "UPDATE provider_connections SET status = 'disconnected', access_token_ciphertext = NULL, refresh_token_ciphertext = NULL, token_expires_at = NULL, scopes_json = '[]', updated_at = ? WHERE account_id = ? AND provider = ?",
    ).bind(now.toISOString(), accountId, provider).run();
    return result.success;
  } catch {
    return false;
  }
}
