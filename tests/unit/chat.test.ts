import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyTwitchEventSubSignature } from "../../packages/shared/src/twitch-eventsub.ts";
import { createOAuthState, createPkceChallenge, createPkceVerifier, digestOAuthState } from "../../packages/shared/src/oauth-state.ts";
import { verifyTikTokConnectorSignature } from "../../packages/shared/src/tiktok-connector-signature.ts";
import {
  ChatMessageDeduplicator, aggregateViewerCounts, emptyProviderHealth,
  normalizePlatformProviderEvent, normalizeTikTokChatMessage, normalizeTikTokProviderEvent, normalizeTwitchChatMessage, normalizeYouTubeChatMessage, normalizeYouTubeProviderEvent, reconnectDelayMs,
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

test("normalizes YouTube messages and rejects malformed Twitch messages", () => {
  const youtube = normalizeYouTubeChatMessage({
    id: "yt-1", snippet: { liveChatId: "live-1", displayMessage: "GG", publishedAt: "2026-10-29T11:00:00Z" },
    authorDetails: { channelId: "user-1", displayName: "YTViewer", isChatModerator: true },
  }, "StreamerYT", now);
  assert.equal(youtube?.badges.moderator, true);
  assert.equal(normalizeTwitchChatMessage(null, now), null);
});

test("normalizes YouTube Super Chats and memberships as stream events", () => {
  const superChat = normalizeYouTubeProviderEvent({
    id: "yt-event-1",
    snippet: {
      type: "superChatEvent", publishedAt: "2026-10-29T11:59:00Z",
      superChatDetails: { amountMicros: "2500000", currency: "USD", userComment: "Thanks!" },
    },
    authorDetails: { channelId: "viewer-1", displayName: "Viewer" },
  }, "live-chat-1", "Streamer", now);
  assert.equal(superChat?.kind, "super_chat");
  assert.equal(superChat?.amount, 2.5);
  assert.equal(superChat?.currency, "USD");
  assert.equal(superChat?.message, "Thanks!");

  const member = normalizeYouTubeProviderEvent({
    id: "yt-event-2",
    snippet: { type: "newSponsorEvent", publishedAt: "2026-10-29T11:59:00Z", newSponsorDetails: { memberLevelName: "Gold" } },
    authorDetails: { channelId: "viewer-2", displayName: "Member" },
  }, "live-chat-1", "Streamer", now);
  assert.equal(member?.kind, "subscription");
  assert.equal(member?.itemName, "Gold");
  assert.equal(normalizeYouTubeProviderEvent({ id: "chat", snippet: { type: "textMessageEvent" }, authorDetails: {} }, "live-chat-1", "Streamer", now), null);
});

test("normalizes Twitch provider events with stable external IDs", () => {
  const twitch = normalizePlatformProviderEvent("twitch", "channel.cheer", {
    subscription: { type: "channel.cheer" },
    event: { broadcaster_user_id: "1", broadcaster_user_name: "Streamer", user_id: "2", user_name: "Viewer", bits: 250, message: "Great run!" },
  }, "twitch-event-1", now);
  assert.equal(twitch?.kind, "bits");
  assert.equal(twitch?.amount, 250);
  assert.equal(twitch?.actorName, "Viewer");
  assert.equal(twitch?.message, "Great run!");
  assert.equal(normalizePlatformProviderEvent("twitch", "unknown.event", {}, "id", now), null);
});

test("normalizes TikTok chat and platform events without inventing cash values", () => {
  const message = normalizeTikTokChatMessage({
    msgId: "tt-msg-1", roomId: "room-1", comment: "Hello chat", createTime: 1793275140,
    user: { userId: "viewer-1", uniqueId: "viewer", nickname: "Viewer", isVerified: true },
  }, "room-1", "Streamer", now);
  assert.equal(message?.provider, "tiktok");
  assert.equal(message?.text, "Hello chat");
  assert.equal(message?.badges.verified, true);

  // Actual tiktok-live-connector WebcastChatMessage shape: ID lives in common.msgId and text in content.
  const actualConnectorMessage = normalizeTikTokChatMessage({
    common: { msgId: "actual-connector-msg-1" }, content: "Hello from a real connector-shaped payload",
    user: { userId: "viewer-2", uniqueId: "actualviewer", nickname: "Actual Viewer" },
  }, "room-1", "Streamer", now);
  assert.equal(actualConnectorMessage?.externalMessageId, "actual-connector-msg-1");
  assert.equal(actualConnectorMessage?.text, "Hello from a real connector-shaped payload");

  const gift = normalizeTikTokProviderEvent("gift", {
    eventId: "gift-event-1", giftName: "Rose", repeatCount: 3,
    user: { userId: "viewer-1", nickname: "Viewer" }, createTime: 1793275140,
  }, "room-1", "Streamer", now);
  assert.equal(gift?.kind, "gift");
  assert.equal(gift?.itemName, "Rose");
  assert.equal(gift?.quantity, 3);
  assert.equal(gift?.amount, null);
  const connectorGift = normalizeTikTokProviderEvent("gift", {
    common: { msgId: "gift-msg-9", createTime: 1793275140 }, giftId: 5655, repeatCount: 4,
    giftDetails: { giftName: "Rose", giftType: 0 },
    user: { userId: "viewer-3", uniqueId: "gifter", nickname: "Gift Viewer" },
  }, "room-1", "Streamer", now);
  assert.equal(connectorGift?.externalEventId, "gift-msg-9");
  assert.equal(connectorGift?.itemName, "Rose");
  assert.equal(connectorGift?.quantity, 4);

  // Actual TikTok LIVE protobuf event shape: event metadata is nested inside
  // event.msgId/event.createTime for follow, like, share, and member callbacks.
  const follow = normalizeTikTokProviderEvent("follow", {
    event: { msgId: "follow-msg-1", createTime: "1793275140" },
    user: { userId: "viewer-follow-1", uniqueId: "follower", nickname: "Follower" },
  }, "room-1", "Streamer", now);
  assert.equal(follow?.kind, "follow");
  assert.equal(follow?.externalEventId, "follow-msg-1");
  assert.equal(follow?.actorName, "follower");
  assert.equal(follow?.occurredAt, new Date(1793275140 * 1000).toISOString());

  const like = normalizeTikTokProviderEvent("like", {
    event: { msgId: "like-msg-1", createTime: "1793275141" },
    user: { userId: "viewer-like-1", uniqueId: "liker", nickname: "Liker" },
    likeCount: 18, totalLikeCount: 120,
  }, "room-1", "Streamer", now);
  assert.equal(like?.kind, "like");
  assert.equal(like?.externalEventId, "like-msg-1");
  assert.equal(like?.quantity, 18);

  const share = normalizeTikTokProviderEvent("share", {
    event: { msgId: "share-msg-1", createTime: "1793275142" },
    user: { userId: "viewer-share-1", uniqueId: "sharer", nickname: "Sharer" },
  }, "room-1", "Streamer", now);
  assert.equal(share?.kind, "share");
  assert.equal(share?.externalEventId, "share-msg-1");

  const member = normalizeTikTokProviderEvent("member", {
    event: { msgId: "member-msg-1", createTime: "1793275143" },
    user: { userId: "viewer-member-1", uniqueId: "member", nickname: "Member" },
  }, "room-1", "Streamer", now);
  assert.equal(member?.kind, "member_join");
  assert.equal(member?.externalEventId, "member-msg-1");

  const subscription = normalizeTikTokProviderEvent("subNotify", {
    event: { msgId: "sub-msg-1", createTime: "1793275144" },
    user: { userId: "viewer-sub-1", uniqueId: "subscriber", nickname: "Subscriber" },
    subMonth: 3, subscribeType: 1,
  }, "room-1", "Streamer", now);
  assert.equal(subscription?.kind, "subscription");
  assert.equal(subscription?.externalEventId, "sub-msg-1");
  assert.equal(subscription?.quantity, 3);
  assert.equal(subscription?.itemName, "TikTok LIVE subscription");

  const protobufViewerStats = normalizeTikTokProviderEvent("room_user", {
    common: { msgId: "viewer-count-2" }, total: "41", totalUser: "39",
  }, "room-1", "Streamer", now);
  assert.equal(protobufViewerStats?.kind, "viewer_count");
  assert.equal(protobufViewerStats?.quantity, 39);
  assert.equal(normalizeTikTokProviderEvent("unknown", { id: "x" }, "room-1", "Streamer", now), null);
  assert.equal(emptyProviderHealth("tiktok", now).state, "disconnected");
  assert.equal(emptyProviderHealth("tiktok", now).unofficial, true);
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

test("verifies Twitch EventSub HMAC signatures and rejects stale or tampered messages", async () => {
  const secret = "unit-test-eventsub-secret-32-chars";
  const messageId = "twitch-event-1";
  const timestamp = now.toISOString();
  const rawBody = JSON.stringify({ subscription: { type: "channel.chat.message" }, event: { message_id: "m1" } });
  const signature = "sha256=" + createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex");
  const input = { messageId, timestamp, signature, rawBody };
  assert.equal(await verifyTwitchEventSubSignature(input, secret, now), true);
  assert.equal(await verifyTwitchEventSubSignature({ ...input, rawBody: rawBody + " " }, secret, now), false);
  assert.equal(await verifyTwitchEventSubSignature(input, secret, new Date(now.getTime() + 20 * 60_000)), false);
  assert.equal(await verifyTwitchEventSubSignature({ ...input, signature: "sha256=bad" }, secret, now), false);
  assert.equal(await verifyTwitchEventSubSignature(input, "short", now), false);
});



test("verifies signed TikTok bridge requests and rejects stale or tampered payloads", async () => {
  const secret = "unit-test-tiktok-bridge-secret-32-chars";
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const rawBody = JSON.stringify({ kind: "event", eventName: "gift" });
  const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  assert.equal(await verifyTikTokConnectorSignature(timestamp, signature, rawBody, secret, now), true);
  assert.equal(await verifyTikTokConnectorSignature(timestamp, signature, rawBody + " ", secret, now), false);
  assert.equal(await verifyTikTokConnectorSignature(timestamp, signature, rawBody, "short", now), false);
  assert.equal(await verifyTikTokConnectorSignature(timestamp, signature, rawBody, secret, new Date(now.getTime() + 6 * 60_000)), false);
});
test("OAuth PKCE verifier and S256 challenge match RFC 7636", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(await createPkceChallenge(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const generated = createPkceVerifier();
  assert.equal(generated.length, 43);
  assert.match(await createPkceChallenge(generated), /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(() => createPkceChallenge("short"), /invalid_pkce_verifier/);
});

test("OAuth state is high entropy, digest-only, and rejects malformed values", async () => {
  const state = createOAuthState();
  assert.match(state, /^[a-f0-9]{64}$/);
  assert.notEqual(state, createOAuthState());
  const digest = await digestOAuthState(state);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, state);
  assert.equal(await digestOAuthState(state), digest);
  await assert.rejects(() => digestOAuthState("12345"), /invalid_oauth_state/);
});
