import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrations = ["0001_initial.sql", "0002_auth.sql", "0003_chat_foundation.sql", "0004_provider_oauth_states.sql", "0005_kick_pkce.sql", "0006_provider_events.sql"].map(name =>
  readFileSync(join(root, "migrations", name), "utf8")
);

test("application, authentication, chat, OAuth-state, and provider-event migrations apply cleanly to isolated SQLite", () => {
  const temp = mkdtempSync(join(tmpdir(), "riftpulse-schema-"));
  const dbPath = join(temp, "schema-test.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const sql of migrations) db.exec(sql);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const expected = [
      "accounts", "devices", "pairing_challenges", "provider_connections", "module_settings",
      "chat_commands", "song_requests", "integration_health", "idempotency_keys", "chat_messages", "provider_events",
      "user", "session", "account", "verification", "provider_oauth_states",
    ];
    for (const table of expected) assert.equal(tables.has(table), true, `missing table: ${table}`);
    const healthColumns = new Set(db.prepare("PRAGMA table_info(integration_health)").all().map(row => row.name));
    assert.equal(healthColumns.has("viewer_count_observed_at"), true);

    db.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)").run("acct", "now", "now");
    assert.throws(() => db.prepare(
      "INSERT INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("bad", "acct", "unknown", 0, "{}", "now"), /CHECK constraint failed/);
    assert.throws(() => db.prepare(
      "INSERT INTO chat_commands (id, account_id, command_key, module_key, action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cmd", "acct", "hello", "chat", "reply", "now", "now"), /CHECK constraint failed/);
    db.prepare("INSERT INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ok", "acct", "chat", 1, "{}", "now");

    const insertChat = db.prepare(
      "INSERT INTO chat_messages (id, account_id, provider, external_message_id, channel_id, channel_name, sender_id, sender_name, text, sent_at, received_at, badges_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertChat.run("m1", "acct", "twitch", "external-1", "channel-1", "Channel", "sender-1", "Viewer", "hello", "now", "now", "{}");
    assert.throws(() => insertChat.run("m2", "acct", "twitch", "external-1", "channel-1", "Channel", "sender-1", "Viewer", "duplicate", "now", "now", "{}"), /UNIQUE constraint failed/);
    assert.doesNotThrow(() => insertChat.run("m3", "acct", "youtube", "external-1", "channel-2", "Channel 2", "sender-2", "Viewer 2", "same ID, other provider", "now", "now", "{}"));

    db.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run("u1", "Test User", "test@riftpulse.invalid", 0, Date.now(), Date.now());
    db.prepare("INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)")
      .run("s1", Date.now() + 60_000, "session-token-test", Date.now(), Date.now(), "u1");
    assert.equal(db.prepare("SELECT userId FROM session WHERE token = ?").get("session-token-test").userId, "u1");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
