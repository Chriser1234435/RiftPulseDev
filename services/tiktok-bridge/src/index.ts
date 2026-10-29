import { createHmac } from "node:crypto";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const required = ["RIFTPULSE_INGEST_URL", "TIKTOK_CONNECTOR_INGEST_SECRET"] as const;
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

const ingestUrl = new URL(process.env.RIFTPULSE_INGEST_URL!);
if (ingestUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(ingestUrl.hostname)) {
  throw new Error("RIFTPULSE_INGEST_URL must use HTTPS except for local development.");
}
if (!ingestUrl.pathname.endsWith("/api/v1/providers/tiktok/ingest")) {
  throw new Error("RIFTPULSE_INGEST_URL must point to /api/v1/providers/tiktok/ingest.");
}
const accountsUrl = new URL(ingestUrl);
accountsUrl.pathname = ingestUrl.pathname.replace(
  /\/api\/v1\/providers\/tiktok\/ingest$/,
  "/api/v1/internal/tiktok/accounts",
);
if (accountsUrl.pathname === ingestUrl.pathname) throw new Error("Could not derive the internal TikTok account-list URL.");
const statusUrl = new URL(accountsUrl);
statusUrl.pathname = statusUrl.pathname.replace("/accounts", "/status");
const secret = process.env.TIKTOK_CONNECTOR_INGEST_SECRET!;
if (secret.length < 32) throw new Error("TIKTOK_CONNECTOR_INGEST_SECRET must be at least 32 characters.");
const pollMs = Math.max(10_000, Number(process.env.TIKTOK_ACCOUNT_POLL_MS) || 10_000);
const maxAccounts = Math.max(1, Math.min(50, Number(process.env.TIKTOK_MAX_ACTIVE_ACCOUNTS) || 10));

type AccountConfig = { accountId: string; username: string };
type ConnectorWithEvents = TikTokLiveConnection & { on(event: string, listener: (data: unknown) => void): unknown };

class AccountRunner {
  readonly accountId: string;
  readonly username: string;
  private readonly connection: ConnectorWithEvents;
  private roomId = "";
  private channelName: string;
  private queue = Promise.resolve();
  private stopped = false;
  private reconnectWaiter: (() => void) | null = null;
  private retryWaiter: (() => void) | null = null;
  private reconnectRequested = false;
  private runPromise: Promise<void>;

  constructor(config: AccountConfig) {
    this.accountId = config.accountId;
    this.username = config.username.replace(/^@/, "");
    this.channelName = this.username;
    this.connection = new TikTokLiveConnection(this.username, {}) as ConnectorWithEvents;
    this.connection.on(WebcastEvent.CHAT, data => this.enqueue("chat", data));
    this.connection.on(WebcastEvent.FOLLOW, data => this.enqueue("event", data, "follow"));
    this.connection.on(WebcastEvent.GIFT, data => this.enqueue("event", data, "gift"));
    this.connection.on(WebcastEvent.LIKE, data => this.enqueue("event", data, "like"));
    this.connection.on(WebcastEvent.SHARE, data => this.enqueue("event", data, "share"));
    this.connection.on(WebcastEvent.MEMBER, data => this.enqueue("event", data, "member"));
    this.connection.on(WebcastEvent.ROOM_USER, data => this.enqueue("event", data, "room_user"));
    this.connection.on("disconnected", () => this.requestReconnect("disconnected"));
    this.connection.on("error", () => this.requestReconnect("connector error"));
    this.connection.on("streamEnd", () => this.requestReconnect("stream ended"));
    this.runPromise = this.run();
  }

  private reportStatus(status: "connected" | "disconnected" | "error", channelId?: string): void {
    void fetch(statusUrl, {
      method: "POST",
      headers: { authorization: "Bearer " + secret, "content-type": "application/json" },
      body: JSON.stringify({ accountId: this.accountId, username: this.username, status, ...(channelId ? { channelId } : {}) }),
      signal: AbortSignal.timeout(5_000),
    }).then(response => {
      if (!response.ok) console.warn("TikTok status update was rejected (HTTP " + response.status + ").");
    }).catch(() => console.warn("TikTok status update failed; the next connection sync will retry."));
  }

  private enqueue(kind: "chat" | "event", payload: unknown, eventName?: string): void {
    if (this.stopped || !this.roomId) return;
    this.queue = this.queue.then(async () => {
      const body = JSON.stringify({
        accountId: this.accountId, channelId: this.roomId, channelName: this.channelName, kind,
        ...(eventName ? { eventName } : {}), payload,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(ingestUrl, {
            method: "POST",
            headers: { "content-type": "application/json", "x-riftpulse-timestamp": timestamp, "x-riftpulse-signature": signature },
            body, signal: AbortSignal.timeout(10_000),
          });
          if (response.ok) return;
          if (response.status < 500 && response.status !== 429) {
            console.error(`RiftPulse rejected a TikTok event for one account (HTTP ${response.status}); payload details suppressed.`);
            return;
          }
          lastError = new Error(`HTTP ${response.status}`);
        } catch (error) { lastError = error; }
        await sleep(250 * (attempt + 1));
      }
      console.error("RiftPulse ingest failed after retries; event details suppressed.", lastError instanceof Error ? lastError.message : "network error");
    }).catch(error => console.error("TikTok account queue failed; event details suppressed.", error instanceof Error ? error.message : "unknown error"));
  }

  private requestReconnect(reason: string): void {
    if (this.stopped) return;
    this.roomId = "";
    this.reportStatus(reason === "connector error" ? "error" : "disconnected");
    this.reconnectRequested = true;
    console.info(`TikTok connection for a configured account ended (${reason}); reconnect scheduled.`);
    this.reconnectWaiter?.();
  }

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      this.reconnectRequested = false;
      try {
        const state = await this.connection.connect();
        const roomId = String(state.roomId ?? "");
        if (!roomId) throw new Error("TikTok connector did not return a room ID.");
        if (!this.reconnectRequested) { this.roomId = roomId; this.reportStatus("connected", roomId); }
        attempt = 0;
        console.info(`TikTok LIVE connected for configured account @${this.username}; room ID hidden.`);
        await new Promise<void>(resolve => {
          this.reconnectWaiter = resolve;
          if (this.reconnectRequested || this.stopped) resolve();
        });
        this.reconnectWaiter = null;
      } catch (error) {
        this.roomId = "";
        this.reportStatus("disconnected");
        console.warn(`TikTok connection attempt failed for @${this.username}; account may be offline or connector unavailable.`, error instanceof Error ? error.message : "unknown error");
      }
      if (this.stopped) break;
      attempt++;
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.retryWaiter = null; resolve(); }, pollMs);
        this.retryWaiter = () => { clearTimeout(timer); this.retryWaiter = null; resolve(); };
      });
      try { await this.connection.disconnect(); } catch { /* already disconnected */ }
    }
    await this.queue;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.roomId = "";
    this.reportStatus("disconnected");
    this.reconnectWaiter?.();
    this.retryWaiter?.();
    try { await this.connection.disconnect(); } catch { /* already disconnected */ }
    await this.runPromise;
  }
}

const runners = new Map<string, { username: string; runner: AccountRunner }>();
let shuttingDown = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchConfiguredAccounts(): Promise<AccountConfig[]> {
  const response = await fetch(accountsUrl, {
    headers: { authorization: "Bearer " + secret, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`account-list endpoint returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).accounts)) {
    throw new Error("account-list endpoint returned an invalid response");
  }
  const seen = new Set<string>();
  return ((payload as { accounts: unknown[] }).accounts).flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (typeof value.accountId !== "string" || !value.accountId || typeof value.username !== "string") return [];
    const username = value.username.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9._]{2,24}$/.test(username) || seen.has(value.accountId)) return [];
    seen.add(value.accountId);
    return [{ accountId: value.accountId, username }];
  }).slice(0, maxAccounts);
}

async function syncAccounts(): Promise<void> {
  const accounts = await fetchConfiguredAccounts();
  const desired = new Map(accounts.map(account => [account.accountId, account]));
  for (const [accountId, current] of runners) {
    const next = desired.get(accountId);
    if (!next || next.username.toLowerCase() !== current.username.toLowerCase()) {
      runners.delete(accountId);
      await current.runner.stop();
      console.info("Stopped a TikTok connection because its configuration was removed or changed.");
    }
  }
  for (const account of accounts) {
    if (runners.has(account.accountId)) continue;
    const runner = new AccountRunner(account);
    runners.set(account.accountId, { username: account.username, runner });
  }
  console.info(`TikTok account sync complete: ${runners.size} configured account(s) managed; limit ${maxAccounts}.`);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...runners.values()].map(value => value.runner.stop()));
  runners.clear();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

while (!shuttingDown) {
  try { await syncAccounts(); }
  catch (error) {
    console.error("TikTok account sync failed; keeping current connections and retrying.", error instanceof Error ? error.message : "unknown error");
  }
  await sleep(pollMs);
}
