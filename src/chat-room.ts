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

/** One Durable Object per account; the Worker authenticates and selects the object. */
export class ChatRoom {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

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
      let event: RealtimeChatMessage;
      try { event = await request.json() as RealtimeChatMessage; }
      catch { return new Response("Invalid JSON", { status: 400 }); }
      if (event?.type !== "chat.message" || !event.message || typeof event.message.text !== "string"
        || event.message.text.length < 1 || event.message.text.length > 500
        || typeof event.message.id !== "string" || event.message.id.length > 256) {
        return new Response("Invalid chat event", { status: 400 });
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
