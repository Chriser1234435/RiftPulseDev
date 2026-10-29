import type { NormalizedProviderEvent } from "../packages/contracts/src/chat-v1.ts";

declare const WebSocketPair: new () => [WebSocket, WebSocket];

interface DurableObjectStateLike {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

type RealtimeChatMessage = {
  type: "chat.message";
  message: {
    id: string; provider: "twitch" | "youtube" | "kick" | "tiktok";
    externalMessageId: string; channelId: string; channelName: string;
    senderId: string; senderName: string; text: string;
    sentAt: string; receivedAt: string;
    badges: { moderator: boolean; subscriber: boolean; verified: boolean };
  };
};
type RealtimeProviderEvent = { type: "provider.event"; event: NormalizedProviderEvent };
type RealtimeEvent = RealtimeChatMessage | RealtimeProviderEvent;

function validProvider(value: unknown): value is "twitch" | "youtube" | "kick" | "tiktok" {
  return value === "twitch" || value === "youtube" || value === "kick" || value === "tiktok";
}

/** One Durable Object per account; the Worker authenticates and selects the object. */
export class ChatRoom {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) { this.state = state; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: WebSocket });
    }

    if (url.pathname === "/publish" && request.method === "POST") {
      let event: RealtimeEvent;
      try { event = await request.json() as RealtimeEvent; }
      catch { return new Response("Invalid JSON", { status: 400 }); }
      if (event?.type === "chat.message") {
        const message = event.message;
        if (!message || !validProvider(message.provider) || typeof message.text !== "string"
          || message.text.length < 1 || message.text.length > 500
          || typeof message.id !== "string" || message.id.length < 1 || message.id.length > 256
          || typeof message.channelId !== "string" || message.channelId.length > 128
          || typeof message.senderId !== "string" || message.senderId.length > 128) {
          return new Response("Invalid chat event", { status: 400 });
        }
      } else if (event?.type === "provider.event") {
        const item = event.event;
        if (!item || !validProvider(item.provider) || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 256
          || typeof item.externalEventId !== "string" || item.externalEventId.length > 128
          || typeof item.channelId !== "string" || item.channelId.length < 1 || item.channelId.length > 128
          || typeof item.channelName !== "string" || item.channelName.length > 80
          || !["follow", "subscription", "gift", "bits", "super_chat", "donation", "like", "share", "raid", "member_join", "viewer_count", "other"].includes(item.kind)
          || (item.message !== null && (typeof item.message !== "string" || item.message.length > 500))
          || (item.itemName !== null && (typeof item.itemName !== "string" || item.itemName.length > 100))
          || (item.amount !== null && (typeof item.amount !== "number" || !Number.isFinite(item.amount) || item.amount < 0))
          || (item.quantity !== null && (!Number.isSafeInteger(item.quantity) || item.quantity < 0))) {
          return new Response("Invalid provider event", { status: 400 });
        }
      } else {
        return new Response("Invalid realtime event", { status: 400 });
      }
      const payload = JSON.stringify(event);
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(payload); delivered++; }
        catch { try { socket.close(1011, "Delivery failed"); } catch { /* socket already closed */ } }
      }
      return Response.json({ delivered }, { headers: { "cache-control": "no-store" } });
    }

    return new Response("Not found", { status: 404 });
  }
}
