import type { D1Database } from "../../../src/env.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_CHALLENGES_PER_DEVICE = 3;

export interface PairingRecordInput {
  challengeId: string; deviceId: string; platform: "pcvr" | "quest";
  gameVersion: string; modVersion: string; code: string; deviceCredential: string; now: Date;
}
export type PairingCreateError = "code_conflict" | "too_many_active" | "database_error";

export async function digestPairingCode(code: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(code));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 digest of the mod-held 32-byte device credential. */
export async function digestDeviceCredential(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential.toLowerCase()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stores only an HMAC digest. The raw five-digit code is never persisted. */
export async function createPairingChallenge(
  db: D1Database, input: PairingRecordInput, secret: string,
): Promise<{ ok: true; challengeId: string; expiresAt: string } | { ok: false; reason: PairingCreateError }> {
  const nowIso = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + CHALLENGE_TTL_MS).toISOString();
  const codeDigest = await digestPairingCode(input.code, secret);
  const credentialDigest = await digestDeviceCredential(input.deviceCredential);
  try {
    const expired = await db.prepare("UPDATE pairing_challenges SET status = 'expired', code_digest = NULL WHERE status = 'pending' AND expires_at <= ?")
      .bind(nowIso).run();
    if (!expired.success) return { ok: false, reason: "database_error" };

    const active = await db.prepare(
      "SELECT COUNT(*) AS count FROM pairing_challenges WHERE device_id = ? AND status = 'pending' AND expires_at > ?",
    ).bind(input.deviceId, nowIso).first<{ count: number }>();
    if (!active || typeof active.count !== "number") return { ok: false, reason: "database_error" };
    if (active.count >= MAX_ACTIVE_CHALLENGES_PER_DEVICE) return { ok: false, reason: "too_many_active" };
    const collision = await db.prepare(
      "SELECT id FROM pairing_challenges WHERE code_digest = ? AND status = 'pending' AND expires_at > ? LIMIT 1",
    ).bind(codeDigest, nowIso).first<{ id: string }>();
    if (collision) return { ok: false, reason: "code_conflict" };
    const inserted = await db.prepare(
      `INSERT INTO pairing_challenges
       (id, device_id, platform, game_version, mod_version, code_digest, device_credential_digest, status, attempts, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    ).bind(input.challengeId, input.deviceId, input.platform, input.gameVersion, input.modVersion, codeDigest, credentialDigest, nowIso, expiresAt).run();
    if (!inserted.success) {
      if (inserted.error?.includes("pairing_challenges.code_digest")) {
        return { ok: false, reason: "code_conflict" };
      }
      return { ok: false, reason: "database_error" };
    }
    return { ok: true, challengeId: input.challengeId, expiresAt };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}

/** accountId must come from a verified auth session, never from request JSON. */
export async function claimPairingChallenge(
  db: D1Database, code: string, secret: string, accountId: string, now: Date,
): Promise<{ ok: true; deviceId: string; platform: "pcvr" | "quest" } |
  { ok: false; reason: "invalid_or_expired" | "database_error" }> {
  const nowIso = now.toISOString();
  const codeDigest = await digestPairingCode(code, secret);
  try {
    const candidate = await db.prepare(
      `SELECT id, device_id, platform, device_credential_digest FROM pairing_challenges
       WHERE code_digest = ? AND status = 'pending' AND expires_at > ? LIMIT 1`,
    ).bind(codeDigest, nowIso).first<{ id: string; device_id: string; platform: "pcvr" | "quest"; device_credential_digest: string }>();
    if (!candidate) return { ok: false, reason: "invalid_or_expired" };

    const claimTime = nowIso;
    const results = await db.batch([
      db.prepare(
        `UPDATE pairing_challenges
         SET status = 'claimed', claimed_at = ?, claimed_account_id = ?, code_digest = NULL
         WHERE id = ? AND status = 'pending' AND expires_at > ?
           AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND status = 'active')
           AND NOT EXISTS (SELECT 1 FROM devices WHERE id = pairing_challenges.device_id AND account_id <> ?)`,
      ).bind(claimTime, accountId, candidate.id, nowIso, accountId, accountId),
      db.prepare(
        `INSERT INTO devices (id, account_id, platform, game_version, mod_version, credential_digest, created_at, last_seen_at)
         SELECT device_id, claimed_account_id, platform, game_version, mod_version, device_credential_digest, ?, ?
         FROM pairing_challenges
         WHERE id = ? AND status = 'claimed' AND claimed_account_id = ? AND claimed_at = ?
         ON CONFLICT(id) DO NOTHING`,
      ).bind(claimTime, claimTime, candidate.id, accountId, claimTime),
      db.prepare("UPDATE pairing_challenges SET device_credential_digest = NULL WHERE id = ? AND status = 'claimed' AND claimed_account_id = ? AND claimed_at = ?")
        .bind(candidate.id, accountId, claimTime),
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) return { ok: false, reason: "invalid_or_expired" };
    return { ok: true, deviceId: candidate.device_id, platform: candidate.platform };
  } catch {
    return { ok: false, reason: "database_error" };
  }
}
