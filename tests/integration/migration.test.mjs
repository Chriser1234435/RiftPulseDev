import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migration = join(root, "migrations", "0001_initial.sql");
const sql = readFileSync(migration, "utf8");

test("initial schema applies cleanly to an isolated SQLite database", () => {
  const temp = mkdtempSync(join(tmpdir(), "riftpulse-schema-"));
  const dbPath = join(temp, "schema-test.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(sql);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const expected = ["accounts", "devices", "pairing_challenges", "provider_connections", "module_settings", "chat_commands", "song_requests", "integration_health", "idempotency_keys"];
    for (const table of expected) assert.equal(tables.has(table), true, `missing table: ${table}`);

    db.prepare("INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)").run("acct", "now", "now");
    assert.throws(() => db.prepare(
      "INSERT INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("bad", "acct", "unknown", 0, "{}", "now"), /CHECK constraint failed/);
    assert.throws(() => db.prepare(
      "INSERT INTO chat_commands (id, account_id, command_key, module_key, action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("cmd", "acct", "hello", "chat", "reply", "now", "now"), /CHECK constraint failed/);

    db.prepare("INSERT INTO module_settings (id, account_id, module_key, enabled, settings_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ok", "acct", "chat", 1, "{}", "now");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
