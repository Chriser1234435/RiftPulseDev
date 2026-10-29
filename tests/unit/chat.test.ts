import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatMessageDeduplicator, aggregateViewerCounts, emptyProviderHealth, normalizeKickChatMessage,
  normalizeTwitchChatMessage, normalizeYouTubeChatMessage, reconnectDelayMs,
} from "../../packages/shared/src/chat.ts";
import type { ProviderHealthSnapshot } from "../../packages/contracts/src/chat-v1.ts";

const now = new Date("2026-10-29T12:00:00.000Z");

test("normalizes Twitch messages and strips control characters", () => {
  const message = normalizeTwitchChatMessage({ event: {
    message_id: "tw-1", broadcaster_user_id: "1", broadcaster_user_name: "Streamer",
    chatter_user_id: "2", chatter_user_name: "Viewer", sent_at: "2026-10-29T11:59:00Z",
    message: { text: "Hi\u0000   there" }, badges: [{ set_id: "moderator" }],
  } }, now);
  assert.ok(message);
  assert.equal(message.id, "twitch:tw-1");
  assert.equal(message.text, "Hi there");
  assert.equal(message.badges.moderator, true);
});

test("normalizes YouTube and Kick messages", () => {
  const youtube = normalizeYouTubeChatMessage({
    id: "yt-1", snippet: { liveChatId: "live-1", displayMessage: "GG", publishedAt: "2026-10-29T11:00:00Z" },
    authorDetails: { channelId: "user-1", displayName: "YTViewer", isChatModerator: true },
  }, "StreamerYT", now);
  const kick = normalizeKickChatMessage({
    message_id: "kick-1", broadcaster: { user_id: 10, username: "StreamerK" },
    sender: { user_id: 20, username: "KickViewer", is_verified: true, identity: { badges: [{ type: "moderator" }] } },
    content: "Nice run", created_at: "2026-10-29T11:30:00Z",
  }, now);
  assert.equal(youtube?.badges.moderator, true);
  assert.equal(kick?.channelId, "10");
  assert.equal(kick?.badges.verified, true);
  assert.equal(kick?.badges.moderator, true);
  assert.equal(normalizeTwitchChatMessage(null, now), null);
});

test("deduplicates provider message IDs, expires entries, and stays bounded", () => {
  const dedupe = new ChatMessageDeduplicator(100, 2);
  const twitch = { provider: "twitch" as const, externalMessageId: "same" };
  assert.equal(dedupe.accept(twitch, 0), true);
  assert.equal(dedupe.accept(twitch, 10), false);
  assert.equal(dedupe.accept({ provider: "youtube", externalMessageId: "same" }, 10), true);
  assert.equal(dedupe.accept({ provider: "kick", externalMessageId: "other" }, 20), true);
  assert.equal(dedupe.accept(twitch, 30), true);
  assert.equal(dedupe.size, 2);
  dedupe.accept({ provider: "youtube", externalMessageId: "new" }, 200);
  assert.equal(dedupe.size, 1);
});

test("uses bounded exponential reconnect jitter", () => {
  assert.equal(reconnectDelayMs(0, () => 0.5), 500);
  assert.equal(reconnectDelayMs(4, () => 0.5), 8000);
  assert.equal(reconnectDelayMs(30, () => 1), 60_000);
});

test("viewer aggregation distinguishes unknown, zero, stale, and partial data", () => {
  const snapshots: ProviderHealthSnapshot[] = [
    { ...emptyProviderHealth("twitch", now), state: "connected", viewerCount: 0, viewerCountObservedAt: now.toISOString() },
    { ...emptyProviderHealth("youtube", now), state: "degraded", viewerCount: 15, viewerCountObservedAt: now.toISOString() },
    { ...emptyProviderHealth("kick", now), state: "connected", viewerCount: 500, viewerCountObservedAt: "2026-10-29T11:00:00Z" },
    emptyProviderHealth("tiktok", now),
  ];
  const result = aggregateViewerCounts(snapshots, now);
  assert.equal(result.total, 15);
  assert.equal(result.partial, true);
  assert.deepEqual(result.includedProviders, ["twitch", "youtube"]);
  assert.equal(aggregateViewerCounts([emptyProviderHealth("twitch", now)], now).total, null);
});
