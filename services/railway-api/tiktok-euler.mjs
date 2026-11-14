import { createHmac } from "node:crypto";
import WebSocket from "ws";
import { createBaseWebcastPushFrame, deserializeWebSocketMessage } from "tiktok-live-connector";

const MAX_CONCURRENT = 25;
const MAX_INGEST_BYTES = 14_000;
const USER_FIELDS = [
  "userId", "user_id", "id", "uniqueId", "nickname", "displayId", "username",
  "isModerator", "isSubscriber", "isVerified",
];
const GIFT_FIELDS = ["giftId", "id", "giftName", "name", "giftType"];
const ROOT_FIELDS = [
  "msgId", "messageId", "commentId", "id", "roomId", "room_id", "roomName",
  "comment", "text", "content", "createTime", "create_time", "timestamp",
  "isModerator", "isSubscriber", "repeatEnd", "repeatCount", "repeat_count",
  "count", "likeCount", "subMonth", "viewerCount", "totalUser", "total",
  "totalUserCount", "memberCount", "amount", "superChatAmount", "bits",
  "currency", "giftId", "giftName", "gift_name",
];

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function scalar(value, maxLength = 256) {
  if (typeof value === "string") return value.slice(0, maxLength);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

function pickFields(source, fields, limits = {}) {
  const input = asRecord(source);
  if (!input) return undefined;
  const output = {};
  for (const key of fields) {
    const value = scalar(input[key], limits[key] ?? 256);
    if (value !== undefined) output[key] = value;
  }
  return Object.keys(output).length ? output : undefined;
}

export function compactTikTokPayload(source) {
  const root = asRecord(source);
  if (!root) return {};
  const output = pickFields(root, ROOT_FIELDS, {
    comment: 500, text: 500, content: 500, giftName: 100, gift_name: 100,
    roomName: 80, currency: 8,
  }) ?? {};

  const user = pickFields(root.user ?? root.userInfo, USER_FIELDS, {
    uniqueId: 80, nickname: 80, displayId: 80, username: 80,
  });
  const gifter = pickFields(root.gifter, USER_FIELDS, {
    uniqueId: 80, nickname: 80, displayId: 80, username: 80,
  });
  const commonSource = asRecord(root.common);
  const common = commonSource ? (pickFields(commonSource, [
    "msgId", "messageId", "logId", "createTime", "create_time", "timestamp",
  ]) ?? {}) : undefined;
  const displayText = pickFields(commonSource?.displayText, ["key"], { key: 120 });
  if (displayText) common.displayText = displayText;

  const giftDetails = pickFields(root.giftDetails, GIFT_FIELDS, { giftName: 100, name: 100 });
  const extendedGiftInfo = pickFields(root.extendedGiftInfo, GIFT_FIELDS, { giftName: 100, name: 100 });
  const gift = pickFields(root.gift, GIFT_FIELDS, { giftName: 100, name: 100 });
  const room = pickFields(root.room, ["id", "title"], { title: 80 });

  if (user) output.user = user;
  if (gifter) output.gifter = gifter;
  if (common && Object.keys(common).length) output.common = common;
  if (giftDetails) output.giftDetails = giftDetails;
  if (extendedGiftInfo) output.extendedGiftInfo = extendedGiftInfo;
  if (gift) output.gift = gift;
  if (room) output.room = room;
  return output;
}

export function eventForMessage(method, data) {
  switch (method) {
    case "WebcastChatMessage":
      return { kind: "chat", payload: data };
    case "WebcastGiftMessage":
      return { kind: "event", eventName: "gift", payload: data };
    case "WebcastLikeMessage":
      return { kind: "event", eventName: "like", payload: data };
    case "WebcastMemberMessage":
      return { kind: "event", eventName: "member", payload: data };
    case "WebcastRoomUserSeqMessage":
      return { kind: "viewers", payload: data };
    case "WebcastSubNotifyMessage":
      return { kind: "event", eventName: "subNotify", payload: data };
    case "WebcastSocialMessage": {
      const key = String(asRecord(asRecord(data)?.common)?.displayText?.key ?? "").toLowerCase();
      if (key.includes("follow")) return { kind: "event", eventName: "follow", payload: data };
      if (key.includes("share")) return { kind: "event", eventName: "share", payload: data };
      return null;
    }
    case "WebcastShareMessage":
      return { kind: "event", eventName: "share", payload: data };
    case "WebcastFollowMessage":
      return { kind: "event", eventName: "follow", payload: data };
    default:
      return null;
  }
}

function websocketBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data.map(part => Buffer.from(part)));
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}

function makeEulerUrl(username, apiKey) {
  const url = new URL("wss://ws.eulerstream.com");
  url.searchParams.set("uniqueId", username);
  url.searchParams.set("apiKey", apiKey);
  // rawMessages forwards the original TikTok Webcast protobuf frames.
  // The decoder below turns those frames back into typed Webcast events.
  url.searchParams.set("features.rawMessages", "true");
  url.searchParams.set("features.normalizeUniqueId", "true");
  url.searchParams.set("features.bundleEvents", "true");
  url.searchParams.set("features.closeInactiveWebSocketAfter", "900");
  return url;
}

export function startTikTokEulerConnector({ worker, env }) {
  const disabled = process.env.TIKTOK_EULER_CONNECTOR_DISABLED === "true";
  const apiKey = process.env.EULER_API_KEY?.trim();
  const secret = env.TIKTOK_CONNECTOR_INGEST_SECRET?.trim();
  if (disabled) {
    console.info("Euler TikTok connector disabled by configuration.");
    return async () => {};
  }
  if (!apiKey || !secret) {
    console.warn("Euler TikTok connector not started; API key or ingest secret is missing.");
    return async () => {};
  }

  const pollMs = Math.max(15_000, Number(process.env.TIKTOK_ACCOUNT_POLL_MS) || 30_000);
  const maxAccounts = Math.max(1, Math.min(MAX_CONCURRENT, Number(process.env.TIKTOK_EULER_MAX_ACCOUNTS) || MAX_CONCURRENT));
  const runners = new Map();
  let stopped = false;
  let syncInProgress = false;

  async function callWorker(path, method = "GET", body = undefined, extraHeaders = {}) {
    const headers = new Headers(extraHeaders);
    headers.set("authorization", "Bearer " + secret);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await worker.fetch(new Request("https://riftpulse.internal" + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }), env);
    return response;
  }

  class AccountRunner {
    constructor(account) {
      this.accountId = account.accountId;
      this.username = account.username.replace(/^@/, "");
      this.channelId = this.username;
      this.socket = null;
      this.queue = Promise.resolve();
      this.stopped = false;
      this.attempt = 0;
      this.lastStatus = null;
      this.statusQueue = Promise.resolve();
      this.runPromise = this.run();
    }

    reportStatus(status) {
      this.statusQueue = this.statusQueue.then(async () => {
        if (this.lastStatus === status) return;
        try {
          const response = await callWorker("/api/v1/internal/tiktok/status", "POST", {
            accountId: this.accountId,
            username: this.username,
            status,
            ...(status === "connected" ? { channelId: this.channelId } : {}),
          });
          if (!response.ok) {
            console.warn("Euler TikTok status update rejected (HTTP " + response.status + ") for one account.");
            return;
          }
          this.lastStatus = status;
        } catch {
          console.warn("Euler TikTok status update failed for one account.");
        }
      }).catch(() => console.warn("Euler TikTok status queue failed for one account."));
      return this.statusQueue;
    }

    enqueueFrame(data) {
      if (this.stopped) return;
      this.queue = this.queue.then(() => this.handleFrame(data)).catch(() => {
        console.warn("Euler TikTok frame could not be decoded; frame details suppressed.");
      });
    }

    async ingest(message) {
      const compactPayload = compactTikTokPayload(message.payload);
      const bodyObject = {
        accountId: this.accountId,
        channelId: this.channelId,
        channelName: this.username,
        kind: message.kind,
        ...(message.eventName ? { eventName: message.eventName } : {}),
        payload: compactPayload,
      };
      const body = JSON.stringify(bodyObject);
      const byteLength = Buffer.byteLength(body, "utf8");
      if (byteLength > MAX_INGEST_BYTES) {
        console.warn("Euler TikTok event skipped because the compact payload exceeded the ingest limit.");
        return;
      }
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
      try {
        const response = await worker.fetch(new Request("https://riftpulse.internal/api/v1/providers/tiktok/ingest", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-riftpulse-timestamp": timestamp,
            "x-riftpulse-signature": signature,
          },
          body,
        }), env);
        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          const code = errorBody?.error?.code ?? "ingest_rejected";
          console.warn("RiftPulse rejected a compact Euler TikTok event (HTTP " + response.status + ", " + String(code).slice(0, 80) + ").");
        }
      } catch {
        console.warn("Euler TikTok event could not reach the RiftPulse ingest handler.");
      }
    }

    async handleFrame(data) {
      const frame = await deserializeWebSocketMessage(websocketBuffer(data));
      const result = frame?.protoMessageFetchResult;
      if (!result) return;

      if (result.needAck && frame.logId && result.internalExt && this.socket?.readyState === WebSocket.OPEN) {
        const ack = createBaseWebcastPushFrame({
          logId: frame.logId,
          payloadEncoding: "pb",
          payloadType: "ack",
          payload: Buffer.from(String(result.internalExt), "utf8"),
        });
        this.socket.send(Buffer.from(ack.finish()));
      }

      for (const entry of result.messages ?? []) {
        const decoded = asRecord(entry?.decodedData);
        if (!decoded) continue;
        const method = String(entry.method ?? decoded.type ?? "");
        const dataObject = asRecord(decoded.data);
        if (!dataObject) continue;

        const roomId = scalar(dataObject.roomId ?? dataObject.room_id, 128);
        if (roomId !== undefined && String(roomId)) this.channelId = String(roomId);

        const mapped = eventForMessage(method, dataObject);
        if (!mapped) continue;

        const giftDetails = asRecord(dataObject.giftDetails);
        if (mapped.eventName === "gift" && giftDetails?.giftType === 1
          && dataObject.repeatEnd !== true && dataObject.repeatEnd !== 1) continue;

        await this.ingest(mapped);
      }
    }

    async connectOnce() {
      return new Promise(resolve => {
        if (this.stopped) return resolve();
        const socket = new WebSocket(makeEulerUrl(this.username, apiKey), {
          handshakeTimeout: 15_000,
          perMessageDeflate: false,
        });
        this.socket = socket;
        let done = false;
        const finish = (code = 0) => {
          if (done) return;
          done = true;
          if (this.socket === socket) this.socket = null;
          void this.reportStatus("disconnected");
          if (code === 4404 || code === 4005) this.attempt = Math.max(this.attempt, 3);
          if (code === 4429) this.attempt = Math.max(this.attempt, 5);
          resolve();
        };
        socket.on("open", () => {
          if (this.stopped) {
            socket.close(1000, "RiftPulse shutting down");
            return;
          }
          this.attempt = 0;
          void this.reportStatus("connected");
          console.info("Euler TikTok LIVE connected for @" + this.username + ".");
        });
        socket.on("message", data => this.enqueueFrame(data));
        socket.on("close", (code) => {
          console.info("Euler TikTok socket closed for @" + this.username + " (code " + code + ").");
          finish(code);
        });
        socket.on("error", () => {
          console.warn("Euler TikTok WebSocket error for @" + this.username + "; reconnect scheduled.");
          try { socket.close(); } catch { finish(); }
        });
      });
    }

    async run() {
      while (!this.stopped) {
        await this.connectOnce();
        if (this.stopped) break;
        this.attempt += 1;
        const delay = Math.min(300_000, 5_000 * (2 ** Math.min(this.attempt, 6)));
        await new Promise(resolve => {
          const timer = setTimeout(resolve, delay);
          timer.unref?.();
          this.retryTimer = timer;
        });
        this.retryTimer = null;
      }
      await this.queue;
    }

    async stop() {
      if (this.stopped) return;
      this.stopped = true;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      const socket = this.socket;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        try { socket.close(1000, "RiftPulse account removed"); } catch {}
      }
      await this.runPromise;
      await this.reportStatus("disconnected");
    }
  }

  async function syncAccounts() {
    if (syncInProgress || stopped) return;
    syncInProgress = true;
    try {
      const response = await callWorker("/api/v1/internal/tiktok/accounts");
      if (!response.ok) throw new Error("TikTok account list unavailable (HTTP " + response.status + ").");
      const payload = await response.json();
      if (!Array.isArray(payload?.accounts)) throw new Error("TikTok account list response was invalid.");

      const accounts = payload.accounts
        .filter(account => account && typeof account.accountId === "string" && typeof account.username === "string")
        .map(account => ({ accountId: account.accountId, username: account.username.trim().replace(/^@/, "") }))
        .filter(account => /^[A-Za-z0-9._]{2,24}$/.test(account.username));
      const desired = new Map(accounts.slice(0, maxAccounts).map(account => [account.accountId, account]));

      for (const [accountId, runner] of runners) {
        const next = desired.get(accountId);
        if (!next || next.username.toLowerCase() !== runner.username.toLowerCase()) {
          runners.delete(accountId);
          await runner.stop();
        }
      }

      for (const account of desired.values()) {
        if (runners.has(account.accountId)) continue;
        const runner = new AccountRunner(account);
        runners.set(account.accountId, runner);
      }

      if (accounts.length > maxAccounts) {
        console.warn("Euler Community connection limit reached; " + (accounts.length - maxAccounts) + " configured TikTok account(s) are waiting.");
      }
      console.info("Euler TikTok account sync complete: " + runners.size + " account(s) managed; limit " + maxAccounts + ".");
    } catch (error) {
      console.warn("Euler TikTok account sync failed; current connections were retained.", error instanceof Error ? error.message : "unknown error");
    } finally {
      syncInProgress = false;
    }
  }

  void syncAccounts();
  const timer = setInterval(() => void syncAccounts(), pollMs);
  timer.unref?.();

  return async function stopTikTokEulerConnector() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await Promise.all([...runners.values()].map(runner => runner.stop()));
    runners.clear();
  };
}
