import { createHmac } from "node:crypto";
import { IsLiveRouteConfig, RoomIdRouteConfig, TikTokLiveConnection, UserOfflineError, WebcastEvent } from "tiktok-live-connector";

if (process.env.RIFTPULSE_CONNECTOR_DISABLED === "true") {
  console.info("TikTok connector disabled by configuration; no accounts will be connected.");
  await new Promise<void>(() => {});
}

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
// The connector receives EULER_API_KEY in its constructor below via the
// supported signApiKey option. Do not mutate the library's global route config.
// Community-plan mode: skip Euler fallback routes requiring Business access.
IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;
RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;
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
  private lastReportedStatus: "connected" | "disconnected" | "error" | null = null;
  private lastReportedChannelId = "";
  private lastStatusAttemptStatus: "connected" | "disconnected" | "error" | null = null;
  private lastStatusAttemptChannelId = "";
  private lastStatusAttemptAt = 0;
  private reconnectWaiter: (() => void) | null = null;
  private retryWaiter: (() => void) | null = null;
  private reconnectRequested = false;
  private readonly stopController = new AbortController();
  private runPromise: Promise<void>;

  constructor(config: AccountConfig) {
    this.accountId = config.accountId;
    this.username = config.username.replace(/^@/, "");
    this.channelName = this.username;
    const eulerApiKey = process.env.EULER_API_KEY?.trim();
    this.connection = new TikTokLiveConnection(this.username, {
      // Community tier: disable premium gift-gallery enrichment.
      enableExtendedGiftInfo: false,
      ...(eulerApiKey ? { signApiKey: eulerApiKey } : {}),
    }) as ConnectorWithEvents;
    this.connection.on(WebcastEvent.CHAT, data => this.enqueue("chat", data));
    this.connection.on(WebcastEvent.FOLLOW, data => this.enqueue("event", data, "follow"));
    this.connection.on(WebcastEvent.GIFT, data => { const gift = data as Record<string, unknown>; const details = gift.giftDetails as Record<string, unknown> | undefined; if (details?.giftType === 1 && gift.repeatEnd !== true && gift.repeatEnd !== 1) return; this.enqueue("event", data, "gift"); });
    this.connection.on(WebcastEvent.LIKE, data => this.enqueue("event", data, "like"));
    this.connection.on(WebcastEvent.SHARE, data => this.enqueue("event", data, "share"));
    this.connection.on(WebcastEvent.MEMBER, data => this.enqueue("event", data, "member"));
    this.connection.on(WebcastEvent.SUB_NOTIFY, data => this.enqueue("event", data, "subNotify"));
    this.connection.on(WebcastEvent.ROOM_USER, data => this.enqueue("viewers", data));
    this.connection.on("disconnected", () => this.requestReconnect("disconnected"));
    // The connector emits error events for normal offline-user lookups as well as
    // transient stream failures. Keep the account in a retrying/disconnected state;
    // do not persist a fatal Error badge for a connection that is expected to retry.
    this.connection.on("error", () => this.requestReconnect("disconnected"));
    this.connection.on("streamEnd", () => this.requestReconnect("stream ended"));
    this.runPromise = this.run();
  }

  private reportStatus(status: "connected" | "disconnected" | "error", channelId?: string): void {
    const reportedChannelId = channelId ?? "";
    if (this.lastReportedStatus === status && this.lastReportedChannelId === reportedChannelId) return;
    // Retry failed status writes at most once per minute. Only mark a status as
    // reported after the API confirms it, so a temporary D1 outage can recover.
    if (this.lastStatusAttemptStatus === status && this.lastStatusAttemptChannelId === reportedChannelId
      && Date.now() - this.lastStatusAttemptAt < 60_000) return;
    this.lastStatusAttemptStatus = status;
    this.lastStatusAttemptChannelId = reportedChannelId;
    this.lastStatusAttemptAt = Date.now();
    void fetch(statusUrl, {
      method: "POST",
      headers: { authorization: "Bearer " + secret, "content-type": "application/json" },
      body: JSON.stringify({ accountId: this.accountId, username: this.username, status, ...(channelId ? { channelId } : {}) }),
      signal: AbortSignal.timeout(5_000),
    }).then(response => {
      if (!response.ok) {
        console.warn("TikTok status update was rejected (HTTP " + response.status + ").");
        return;
      }
      if (this.lastStatusAttemptStatus === status && this.lastStatusAttemptChannelId === reportedChannelId) {
        this.lastReportedStatus = status;
        this.lastReportedChannelId = reportedChannelId;
      }
    }).catch(() => console.warn("TikTok status update failed; retry is rate-limited to once per minute."));
  }

  private enqueue(kind: "chat" | "event" | "viewers", payload: unknown, eventName?: string): void {
    // Capture the room at event time. The runner clears this.roomId immediately
    // on disconnect; reading it later inside the queued callback used to send an
    // empty channelId for events waiting behind another ingest request.
    const channelId = this.roomId;
    if (this.stopped || !channelId) return;
    this.queue = this.queue.then(async () => {
      const body = JSON.stringify({
        accountId: this.accountId, channelId, channelName: this.channelName, kind,
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
    this.reportStatus("disconnected");
    this.reconnectRequested = true;
    console.info(`TikTok connection for a configured account ended (${reason}); reconnect scheduled.`);
    this.reconnectWaiter?.();
  }

  private async run(): Promise<void> {
    let attempt = 0;
    const liveCheckSeconds = Math.max(30, Math.ceil(pollMs / 1000));
    while (!this.stopped) {
      this.reconnectRequested = false;
      this.roomId = "";
      this.reportStatus("disconnected");

      try {
        // Do not hammer room lookups while a configured creator is offline.
        // The connector polls live state at a minimum 30-second interval and
        // the AbortSignal lets account removal/shutdown stop the wait cleanly.
        await this.connection.waitUntilLive(liveCheckSeconds, this.stopController.signal);
        if (this.stopped) break;

        const state = await this.connection.connect();
        const roomId = String(state.roomId ?? "");
        if (!roomId) throw new Error("TikTok connector did not return a room ID.");
        if (!this.reconnectRequested) {
          this.roomId = roomId;
          this.reportStatus("connected", roomId);
        }
        attempt = 0;
        console.info(`TikTok LIVE connected for configured account @${this.username}; room ID hidden.`);
        await new Promise<void>(resolve => {
          this.reconnectWaiter = resolve;
          if (this.reconnectRequested || this.stopped) resolve();
        });
        this.reconnectWaiter = null;
      } catch (error) {
        this.roomId = "";
        if (this.stopped) break;
        this.reportStatus("disconnected");
        const errorName = error instanceof Error ? error.name : "UnknownError";
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        const offline = error instanceof UserOfflineError || /isn't online|not online|offline/i.test(errorMessage);
        const reason = offline ? "account_offline"
          : /room id|fetchisLive|all sources/i.test(errorMessage) ? "room_lookup_failed"
          : "connection_failed";
        const errorObject = error && typeof error === "object"
          ? error as { errors?: unknown[]; config?: { requestErrs?: unknown[] } } : null;
        const nested = errorObject?.config?.requestErrs ?? errorObject?.errors;
        const causes = Array.isArray(nested)
          ? nested.slice(0, 4).map(item => {
              const cause = item && typeof item === "object" && "requestErr" in item
                ? (item as { requestErr?: unknown }).requestErr : item;
              const causeName = cause instanceof Error ? cause.name : "Error";
              const value = cause instanceof Error ? cause.message : String(cause);
              return `${causeName}: ${value.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\r\n]+/g, " ").slice(0, 100)}`;
            })
          : [];
        console.warn("tiktok_live_connection_attempt_failed", JSON.stringify({
          reason,
          errorName,
          message: errorMessage.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\r\n]+/g, " ").slice(0, 160),
          causes,
          eulerApiKeyConfigured: Boolean(process.env.EULER_API_KEY?.trim()),
        }));
      }

      if (this.stopped) break;
      attempt++;
      const retryDelayMs = Math.min(60_000, pollMs * Math.pow(2, Math.min(attempt, 3)));
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.retryWaiter = null; resolve(); }, retryDelayMs);
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
    this.stopController.abort(new Error("TikTok account runner stopped."));
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
