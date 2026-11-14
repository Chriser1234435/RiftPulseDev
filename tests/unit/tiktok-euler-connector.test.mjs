import test from "node:test";
import assert from "node:assert/strict";
import { compactTikTokPayload, eventForMessage, makeEulerUrl, parseEulerMessages } from "../../services/railway-api/tiktok-euler.mjs";

test("compacts a TikTok chat frame to fields used by RiftPulse", () => {
  const compact = compactTikTokPayload({
    msgId: "chat-1",
    comment: "hello from chat",
    createTime: 1_800_000_000,
    user: {
      userId: "123",
      uniqueId: "viewer_one",
      nickname: "Viewer One",
      avatarLarge: { urlList: ["x".repeat(50_000)] },
    },
    common: { msgId: "chat-1", displayText: { key: "chat", description: "x".repeat(10_000) } },
    unusedLargeField: "x".repeat(100_000),
  });

  assert.equal(compact.msgId, "chat-1");
  assert.equal(compact.comment, "hello from chat");
  assert.equal(compact.user.uniqueId, "viewer_one");
  assert.equal(compact.common.displayText.key, "chat");
  assert.equal(compact.unusedLargeField, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 2_000);
});

test("keeps compact gift metadata and repeat markers", () => {
  const compact = compactTikTokPayload({
    repeatCount: 4,
    repeatEnd: true,
    giftDetails: { giftId: 7001, giftName: "Rose", giftType: 1, image: { url: "x".repeat(20_000) } },
    gifter: { userId: "456", nickname: "Gifter", secretField: "x".repeat(50_000) },
  });

  assert.equal(compact.repeatCount, 4);
  assert.equal(compact.repeatEnd, true);
  assert.equal(compact.giftDetails.giftName, "Rose");
  assert.equal(compact.gifter.nickname, "Gifter");
  assert.equal(compact.giftDetails.image, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 2_000);
});

test("maps common Euler JSON event types to RiftPulse ingest types", () => {
  assert.equal(eventForMessage("WebcastChatMessage", {}).kind, "chat");
  assert.equal(eventForMessage("WebcastGiftMessage", {}).eventName, "gift");
  assert.equal(eventForMessage("WebcastLikeMessage", {}).eventName, "like");
  assert.equal(eventForMessage("WebcastMemberMessage", {}).eventName, "member");
  assert.equal(eventForMessage("WebcastRoomUserSeqMessage", {}).kind, "viewers");
  assert.equal(eventForMessage("WebcastSubNotifyMessage", {}).eventName, "subNotify");
  assert.equal(eventForMessage("WebcastSocialMessage", { common: { displayText: { key: "follow_toast" } } }).eventName, "follow");
  assert.equal(eventForMessage("WebcastSocialMessage", { common: { displayText: { key: "share_toast" } } }).eventName, "share");
  assert.equal(eventForMessage("WebcastSocialMessage", { common: { displayText: { key: "other" } } }), null);
});

test("requests Euler parsed JSON events using the v2 schema", () => {
  const url = makeEulerUrl("streamer_name", "test-api-key");
  assert.equal(url.searchParams.get("features.rawMessages"), "false");
  assert.equal(url.searchParams.get("features.schemaVersion"), "v2");
  assert.equal(url.searchParams.get("uniqueId"), "streamer_name");
  assert.equal(url.searchParams.get("apiKey"), "test-api-key");
});

test("parses Euler bundled JSON message envelopes", () => {
  const messages = parseEulerMessages(Buffer.from(JSON.stringify({
    timestamp: Date.now(),
    messages: [
      { type: "WebcastChatMessage", data: { comment: "hello", user: { uniqueId: "viewer" } } },
      { type: "WebcastGiftMessage", data: { giftId: 1, giftName: "Rose" } },
    ],
  }), "utf8"));

  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, "WebcastChatMessage");
  assert.equal(messages[0].data.comment, "hello");
  assert.equal(messages[1].type, "WebcastGiftMessage");
});

test("parses Euler unbundled JSON event envelopes", () => {
  const messages = parseEulerMessages(Buffer.from(JSON.stringify({
    type: "WebcastLikeMessage",
    data: { likeCount: 3, user: { nickname: "Viewer" } },
  }), "utf8"));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "WebcastLikeMessage");
});

test("rejects non-JSON payloads instead of treating JSON wrappers as protobuf bytes", () => {
  assert.throws(() => parseEulerMessages(Buffer.from([0x7b, 0x01, 0x02])), /parsed-JSON/);
});

test("parses a nested Euler data.messages bundle", () => {
  const messages = parseEulerMessages(Buffer.from(JSON.stringify({
    data: {
      messages: [
        { type: "chat", data: { comment: "nested bundle" } },
      ],
    },
  }), "utf8"));

  assert.equal(messages.length, 1);
  assert.equal(eventForMessage(messages[0].type, messages[0].data).kind, "chat");
});

test("maps simplified Euler event aliases", () => {
  assert.equal(eventForMessage("chat", {}).kind, "chat");
  assert.equal(eventForMessage("gift", {}).eventName, "gift");
  assert.equal(eventForMessage("like", {}).eventName, "like");
  assert.equal(eventForMessage("member", {}).eventName, "member");
  assert.equal(eventForMessage("roomUser", {}).kind, "viewers");
  assert.equal(eventForMessage("follow", {}).eventName, "follow");
  assert.equal(eventForMessage("share", {}).eventName, "share");
  assert.equal(eventForMessage("subscription", {}).eventName, "subNotify");
});
