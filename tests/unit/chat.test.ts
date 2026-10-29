import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { extractKickPublicKey, verifyKickWebhookSignature } from "../../packages/shared/src/kick-webhook.ts";
import { verifyTwitchEventSubSignature } from "../../packages/shared/src/twitch-eventsub.ts";
import { createOAuthState, createPkceChallenge, createPkceVerifier, digestOAuthState } from "../../packages/shared/src/oauth-state.ts";
import { verifyTikTokConnectorSignature } from "../../packages/shared/src/tiktok-connector-signature.ts";
import {
  ChatMessageDeduplicator, aggregateViewerCounts, emptyProviderHealth, normalizeKickChatMessage,
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

test("normalizes Twitch and Kick provider events with stable external IDs", () => {
  const twitch = normalizePlatformProviderEvent("twitch", "channel.cheer", {
    subscription: { type: "channel.cheer" },
    event: { broadcaster_user_id: "1", broadcaster_user_name: "Streamer", user_id: "2", user_name: "Viewer", bits: 250, message: "Great run!" },
  }, "twitch-event-1", now);
  assert.equal(twitch?.kind, "bits");
  assert.equal(twitch?.amount, 250);
  assert.equal(twitch?.actorName, "Viewer");
  assert.equal(twitch?.message, "Great run!");

  const kick = normalizePlatformProviderEvent("kick", "channel.followed", {
    broadcaster: { user_id: 10, username: "StreamerK" },
    follower: { user_id: 20, username: "Follower" },
    created_at: "2026-10-29T11:59:00Z",
  }, "kick-event-1", now);
  assert.equal(kick?.kind, "follow");
  assert.equal(kick?.channelId, "10");
  assert.equal(kick?.actorName, "Follower");
  assert.equal(normalizePlatformProviderEvent("kick", "unknown.event", {}, "id", now), null);
});

test("normalizes TikTok chat and platform events without inventing cash values", () => {
  const message = normalizeTikTokChatMessage({
    msgId: "tt-msg-1", roomId: "room-1", comment: "Hello chat", createTime: 1793275140,
    user: { userId: "viewer-1", uniqueId: "viewer", nickname: "Viewer", isVerified: true },
  }, "room-1", "Streamer", now);
  assert.equal(message?.provider, "tiktok");
  assert.equal(message?.text, "Hello chat");
  assert.equal(message?.badges.verified, true);

  const gift = normalizeTikTokProviderEvent("gift", {
    eventId: "gift-event-1", giftName: "Rose", repeatCount: 3,
    user: { userId: "viewer-1", nickname: "Viewer" }, createTime: 1793275140,
  }, "room-1", "Streamer", now);
  assert.equal(gift?.kind, "gift");
  assert.equal(gift?.itemName, "Rose");
  assert.equal(gift?.quantity, 3);
  assert.equal(gift?.amount, null);
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

test("verifies Kick webhook signatures and rejects stale or modified payloads", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const messageId = "01JTESTMESSAGEID";
  const timestamp = now.toISOString();
  const rawBody = JSON.stringify({ message_id: "kick-message-1", content: "hello" });
  const signature = sign("RSA-SHA256", Buffer.from(messageId + "." + timestamp + "." + rawBody), privateKey).toString("base64");
  const input = { messageId, timestamp, signature, rawBody };
  assert.equal(extractKickPublicKey(publicKeyPem), publicKeyPem.trim());
  assert.equal(extractKickPublicKey(JSON.stringify({ data: { public_key: publicKeyPem } })), publicKeyPem.trim());
  assert.equal(extractKickPublicKey("not a key"), null);
  assert.equal(await verifyKickWebhookSignature(input, publicKeyPem, now), true);
  assert.equal(await verifyKickWebhookSignature({ ...input, rawBody: rawBody + " " }, publicKeyPem, now), false);
  assert.equal(await verifyKickWebhookSignature(input, publicKeyPem, new Date(now.getTime() + 10 * 60_000)), false);
  assert.equal(await verifyKickWebhookSignature({ ...input, signature: "not-base64" }, publicKeyPem, now), false);
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
test("Kick PKCE verifier and S256 challenge match RFC 7636", async () => {
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
