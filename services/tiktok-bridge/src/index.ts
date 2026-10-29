import { createHmac } from "node:crypto";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const required = ["RIFTPULSE_INGEST_URL", "RIFTPULSE_ACCOUNT_ID", "TIKTOK_USERNAME", "TIKTOK_CONNECTOR_INGEST_SECRET"] as const;
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

const ingestUrl = new URL(process.env.RIFTPULSE_INGEST_URL!);
if (ingestUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(ingestUrl.hostname)) {
  throw new Error("RIFTPULSE_INGEST_URL must use HTTPS except for local development.");
}
if (!ingestUrl.pathname.endsWith("/api/v1/providers/tiktok/ingest")) {
  throw new Error("RIFTPULSE_INGEST_URL must point to /api/v1/providers/tiktok/ingest.");
}

const accountId = process.env.RIFTPULSE_ACCOUNT_ID!;
const username = process.env.TIKTOK_USERNAME!.replace(/^@/, "");
const secret = process.env.TIKTOK_CONNECTOR_INGEST_SECRET!;
if (secret.length < 32) throw new Error("TIKTOK_CONNECTOR_INGEST_SECRET must be at least 32 characters.");

type ConnectorWithEvents = TikTokLiveConnection & { on(event: string, listener: (data: unknown) => void): unknown };
const connection = new TikTokLiveConnection(username, {}) as ConnectorWithEvents;
let roomId = "";
let channelName = username;
let queue = Promise.resolve();
let shuttingDown = false;

function enqueue(kind: "chat" | "event", payload: unknown, eventName?: string) {
  if (shuttingDown || !roomId) return;
  queue = queue.then(async () => {
    const body = JSON.stringify({
      accountId, channelId: roomId, channelName, kind,
      ...(eventName ? { eventName } : {}), payload,
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(ingestUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-riftpulse-timestamp": timestamp,
            "x-riftpulse-signature": signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) return;
        if (response.status < 500 && response.status !== 429) {
          console.error(`RiftPulse ingest rejected an event (HTTP ${response.status}); payload details suppressed.`);
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    console.error("RiftPulse ingest failed after retries; event details suppressed.", lastError instanceof Error ? lastError.message : "network error");
  }).catch(error => console.error("TikTok bridge queue error; event details suppressed.", error instanceof Error ? error.message : "unknown error"));
}

connection.on(WebcastEvent.CHAT, data => enqueue("chat", data));
connection.on(WebcastEvent.FOLLOW, data => enqueue("event", data, "follow"));
connection.on(WebcastEvent.GIFT, data => enqueue("event", data, "gift"));
connection.on(WebcastEvent.LIKE, data => enqueue("event", data, "like"));
connection.on(WebcastEvent.SHARE, data => enqueue("event", data, "share"));
connection.on(WebcastEvent.MEMBER, data => enqueue("event", data, "member"));
connection.on(WebcastEvent.ROOM_USER, data => enqueue("event", data, "room_user"));
connection.on("streamEnd", () => console.info("TikTok LIVE stream ended; connector will stop forwarding events."));

try {
  const state = await connection.connect();
  roomId = String(state.roomId ?? "");
  if (!roomId) throw new Error("TikTok connector did not return a room ID.");
  console.info(`TikTok bridge connected for @${username}; room ID hidden.`);
} catch (error) {
  console.error("TikTok bridge could not connect. Verify that the account is live and the connector is available.", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}

async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await connection.disconnect(); } catch { /* already disconnected */ }
  await queue;
  process.exit();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
