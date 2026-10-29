import assert from "node:assert/strict";
import test from "node:test";
import { ChatRoom } from "../../src/chat-room.ts";

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  send(value: string) { this.sent.push(value); }
  close() { this.closed = true; }
}

class FakeState {
  readonly sockets: FakeSocket[] = [];
  acceptWebSocket(socket: WebSocket) { this.sockets.push(socket as unknown as FakeSocket); }
  getWebSockets() { return this.sockets as unknown as WebSocket[]; }
}

const message = {
  id: "kick:msg-1", provider: "kick" as const, externalMessageId: "msg-1",
  channelId: "channel-1", channelName: "Channel", senderId: "viewer-1", senderName: "Viewer",
  text: "Nice run", sentAt: "2026-10-29T12:00:00.000Z", receivedAt: "2026-10-29T12:00:01.000Z",
  badges: { moderator: false, subscriber: false, verified: false },
};

test("Durable Object publish validates chat events and fans out to connected sockets", async () => {
  const state = new FakeState();
  const room = new ChatRoom(state);
  const first = new FakeSocket();
  const second = new FakeSocket();
  state.sockets.push(first, second);

  const response = await room.fetch(new Request("https://chat-room/publish", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "chat.message", message }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delivered: 2 });
  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 1);
  assert.deepEqual(JSON.parse(first.sent[0]), { type: "chat.message", message });
});

test("Durable Object rejects malformed or oversized chat event fields", async () => {
  const room = new ChatRoom(new FakeState());
  const invalid = await room.fetch(new Request("https://chat-room/publish", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "chat.message", message: { ...message, text: "" } }),
  }));
  assert.equal(invalid.status, 400);

  const malformed = await room.fetch(new Request("https://chat-room/publish", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }));
  assert.equal(malformed.status, 400);

  const missing = await room.fetch(new Request("https://chat-room/unknown"));
  assert.equal(missing.status, 404);
});
