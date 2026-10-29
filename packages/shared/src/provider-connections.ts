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
  | { ok: true; accessToken: string; refreshToken: string | null; tokenExpiresAt: string | null; scopes: string[] }
  | { ok: false; reason: "not_connected" | "database_error" | "token_decryption_failed" };

export async function readProviderTokens(
  db: D1Database,
  accountId: string,
  provider: ProviderKey,
  encryptionKey: string,
): Promise<ProviderTokenReadResult> {
  let row: {
    accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null;
    tokenExpiresAt: string | null; scopesJson: string; status: string;
  } | null;
  try {
    row = await db.prepare(
      "SELECT access_token_ciphertext AS accessTokenCiphertext, refresh_token_ciphertext AS refreshTokenCiphertext, token_expires_at AS tokenExpiresAt, scopes_json AS scopesJson, status FROM provider_connections WHERE account_id = ? AND provider = ? LIMIT 1",
    ).bind(accountId, provider).first<{
      accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null;
      tokenExpiresAt: string | null; scopesJson: string; status: string;
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
      scopes: scopes as string[],
    };
  } catch {
    return { ok: false, reason: "token_decryption_failed" };
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
