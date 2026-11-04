import assert from "node:assert/strict";
import test from "node:test";
import type { D1Database, D1PreparedStatement, D1Result } from "../../src/env.ts";
import { claimPairingChallenge, digestPairingCode, digestDeviceCredential } from "../../packages/shared/src/pairing.ts";

type StoredChallenge = {
  id: string; device_id: string; platform: "pcvr" | "quest"; game_version: string; mod_version: string;
  code_digest: string | null; device_credential_digest: string | null; status: string; expires_at: string; claimed_at: string | null;
  claimed_account_id: string | null;
};

class ClaimStatement implements D1PreparedStatement {
  values: unknown[] = [];
  readonly db: ClaimDb;
  readonly query: string;
  constructor(db: ClaimDb, query: string) { this.db = db; this.query = query; }
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    const q = this.query.toLowerCase();
    if (q.includes("select id, device_id, platform, device_credential_digest from pairing_challenges")) {
      const [digest, now] = this.values as [string, string];
      const row = [...this.db.challenges.values()].find(ch =>
        ch.code_digest === digest && ch.status === "pending" && ch.expires_at > now
      );
      return row ? ({ id: row.id, device_id: row.device_id, platform: row.platform, device_credential_digest: row.device_credential_digest } as T) : null;
    }
    return null;
  }
  async run<T>(): Promise<D1Result<T>> { return { success: true, meta: { changes: 0 } }; }
  async all<T>(): Promise<D1Result<T>> { return { success: true, results: [] }; }
}

class ClaimDb implements D1Database {
  challenges = new Map<string, StoredChallenge>();
  accounts = new Set<string>(["account-1"]);
  devices = new Map<string, { account_id: string; platform: string; credential_digest: string | null; revoked_at: string | null }>();
  prepare(query: string): D1PreparedStatement { return new ClaimStatement(this, query); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const [update, insert, cleanup] = statements as ClaimStatement[];
    const [claimedAt, accountId, challengeId, now, accountCheck, ownerCheck] =
      update.values as [string, string, string, string, string, string];
    const row = this.challenges.get(challengeId);
    const existing = row ? this.devices.get(row.device_id) : undefined;
    const mayClaim = !!row && row.status === "pending" && row.expires_at > now &&
      this.accounts.has(accountCheck) && (!existing || existing.account_id === ownerCheck);
    if (!mayClaim) return [{ success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }];
    row.status = "claimed";
    row.claimed_at = claimedAt;
    row.claimed_account_id = accountId;
    row.code_digest = null;

    const [createdAt, lastSeenAt, insertId, insertAccount, insertClaimedAt] =
      insert.values as [string, string, string, string, string];
    const claimed = this.challenges.get(insertId);
    if (claimed && claimed.status === "claimed" && claimed.claimed_account_id === insertAccount &&
        claimed.claimed_at === insertClaimedAt && (!existing || existing.account_id === insertAccount)) {
      this.devices.set(claimed.device_id, {
        account_id: insertAccount,
        platform: claimed.platform,
        credential_digest: claimed.device_credential_digest,
        revoked_at: null,
      });
      claimed.device_credential_digest = null;
      void createdAt; void lastSeenAt; void cleanup;
      return [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 1 } }];
    }
    return [{ success: true, meta: { changes: 1 } }, { success: true, meta: { changes: 0 } }, { success: true, meta: { changes: 0 } }];
  }
}

const secret = "unit-test-only-secret-not-for-production-32-bytes";
const now = new Date("2026-10-29T16:00:00.000Z");

async function seededDb(expiresAt = "2026-10-29T16:05:00.000Z"): Promise<ClaimDb> {
  const db = new ClaimDb();
  db.challenges.set("challenge-1", {
    id: "challenge-1", device_id: "device-1", platform: "quest",
    game_version: "1.40.8_7379", mod_version: "0.1.0-dev",
    code_digest: await digestPairingCode("04271", secret),
    device_credential_digest: await digestDeviceCredential("c".repeat(64)), status: "pending",
    expires_at: expiresAt, claimed_at: null, claimed_account_id: null,
  });
  return db;
}

test("claim helper binds a device to an active account once and clears the digest", async () => {
  const db = await seededDb();
  const first = await claimPairingChallenge(db, "04271", secret, "account-1", now);
  assert.deepEqual(first, { ok: true, deviceId: "device-1", platform: "quest" });
  assert.equal(db.challenges.get("challenge-1")?.status, "claimed");
  assert.equal(db.challenges.get("challenge-1")?.code_digest, null);
  assert.equal(db.devices.get("device-1")?.account_id, "account-1");
  assert.equal(db.devices.get("device-1")?.credential_digest, await digestDeviceCredential("c".repeat(64)));
  assert.equal(db.challenges.get("challenge-1")?.device_credential_digest, null);

  const replay = await claimPairingChallenge(db, "04271", secret, "account-1", now);
  assert.deepEqual(replay, { ok: false, reason: "invalid_or_expired" });
});

test("the same RiftPulse account can re-pair a revoked Quest device and rotate its credential", async () => {
  const db = await seededDb();
  const first = await claimPairingChallenge(db, "04271", secret, "account-1", now);
  assert.equal(first.ok, true);
  const device = db.devices.get("device-1");
  assert.ok(device);
  device.revoked_at = now.toISOString();

  db.challenges.set("challenge-2", {
    ...db.challenges.get("challenge-1")!,
    id: "challenge-2",
    code_digest: await digestPairingCode("88888", secret),
    device_credential_digest: await digestDeviceCredential("d".repeat(64)),
    status: "pending",
    expires_at: "2026-10-29T16:05:00.000Z",
    claimed_at: null,
    claimed_account_id: null,
  });

  const second = await claimPairingChallenge(db, "88888", secret, "account-1", now);
  assert.deepEqual(second, { ok: true, deviceId: "device-1", platform: "quest" });
  assert.equal(db.devices.get("device-1")?.account_id, "account-1");
  assert.equal(db.devices.get("device-1")?.credential_digest, await digestDeviceCredential("d".repeat(64)));
  assert.equal(db.devices.get("device-1")?.revoked_at, null);
  assert.equal(db.challenges.get("challenge-2")?.device_credential_digest, null);
});

test("a device already owned by one RiftPulse account cannot be claimed by another", async () => {
  const db = await seededDb();
  db.accounts.add("account-2");
  const first = await claimPairingChallenge(db, "04271", secret, "account-1", now);
  assert.equal(first.ok, true);
  const originalCredential = db.devices.get("device-1")?.credential_digest;

  db.challenges.set("challenge-2", {
    ...db.challenges.get("challenge-1")!,
    id: "challenge-2",
    code_digest: await digestPairingCode("77777", secret),
    device_credential_digest: await digestDeviceCredential("e".repeat(64)),
    status: "pending",
    expires_at: "2026-10-29T16:05:00.000Z",
    claimed_at: null,
    claimed_account_id: null,
  });

  const transfer = await claimPairingChallenge(db, "77777", secret, "account-2", now);
  assert.deepEqual(transfer, { ok: false, reason: "invalid_or_expired" });
  assert.equal(db.devices.get("device-1")?.account_id, "account-1");
  assert.equal(db.devices.get("device-1")?.credential_digest, originalCredential);
});

test("expired challenges cannot be claimed", async () => {
  const db = await seededDb("2026-10-29T15:59:59.000Z");
  const result = await claimPairingChallenge(db, "04271", secret, "account-1", now);
  assert.deepEqual(result, { ok: false, reason: "invalid_or_expired" });
});

test("unknown accounts cannot claim a pairing challenge", async () => {
  const db = await seededDb();
  const result = await claimPairingChallenge(db, "04271", secret, "unknown-account", now);
  assert.deepEqual(result, { ok: false, reason: "invalid_or_expired" });
  assert.equal(db.challenges.get("challenge-1")?.status, "pending");
});
