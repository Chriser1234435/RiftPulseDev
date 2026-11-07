import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const [category, title, summary, version = "", changeList = ""] = process.argv.slice(2);
if (!["website", "mod", "both"].includes(category)) {
  console.error("Usage: npm run release:update -- <website|mod|both> \"Title\" \"Summary\" [version] [\"Change one|Change two\"]");
  process.exit(1);
}
if (!title || title.length > 120 || !summary || summary.length > 500) {
  console.error("A title (1–120 characters) and summary (1–500 characters) are required.");
  process.exit(1);
}
const changes = changeList.split("|").map(value => value.trim()).filter(Boolean).slice(0, 12);
const sqlValue = value => "'" + String(value).replaceAll("'", "''") + "'";
const id = "release-" + randomUUID();
const publishedAt = new Date().toISOString();
const sql = [
  "INSERT INTO release_updates (id, title, category, version, summary, changes_json, published_at) VALUES (",
  [id, title, category, version || null, summary, JSON.stringify(changes), publishedAt]
    .map(value => value === null ? "NULL" : sqlValue(typeof value === "string" ? value : JSON.stringify(value)))
    .join(", "),
  ")",
].join("");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["wrangler", "d1", "execute", "DB", "--remote", "--config", "wrangler.jsonc", "--command", sql], { stdio: "inherit" });
console.log("Published RiftPulse release note:", id);
