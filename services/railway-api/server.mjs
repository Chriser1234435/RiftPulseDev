import { createServer } from "node:http";
import { createAuth } from "../../src/auth.ts";
import worker from "../../src/index.ts";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3000);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

class RemoteD1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new RemoteD1Statement(this.db, this.sql, params); }
  async all() { return this.db.query(this.sql, this.params); }
  async run() { return this.db.query(this.sql, this.params); }
  async first(columnName) {
    const result = await this.all();
    const row = result.results?.[0] ?? null;
    return row && columnName ? row[columnName] ?? null : row;
  }
}
class RemoteD1Database {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    this.databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    this.token = process.env.CLOUDFLARE_API_TOKEN;
  }
  prepare(sql) { return new RemoteD1Statement(this, sql); }
  async query(sql, params = []) {
    if (!this.accountId || !this.databaseId || !this.token) {
      return { success: false, results: [], error: "Cloudflare D1 access is not configured." };
    }
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const payload = await response.json().catch(() => null);
    const result = Array.isArray(payload?.result) ? payload.result[0] : null;
    if (!response.ok || payload?.success !== true || result?.success === false) {
      return { success: false, results: [], error: payload?.errors?.[0]?.message || result?.error || `D1 query failed (${response.status}).` };
    }
    return { success: true, results: result?.results ?? [], meta: result?.meta ?? {} };
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      const result = await this.query(statement.sql, statement.params);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }
}

const db = new RemoteD1Database();
const socketsByAccount = new Map();
const chatRoom = {
  idFromName: (name) => String(name),
  get: (accountId) => ({
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/publish" || request.method !== "POST") return new Response("Not found", { status: 404 });
      let payload;
      try { payload = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
      const sockets = socketsByAccount.get(String(accountId)) ?? new Set();
      const encoded = JSON.stringify(payload);
      let delivered = 0;
      for (const socket of sockets) {
        if (socket.readyState !== 1) { sockets.delete(socket); continue; }
        try { socket.send(encoded); delivered++; } catch { try { socket.close(); } catch {} }
      }
      return Response.json({ delivered }, { headers: { "cache-control": "no-store" } });
    },
  }),
};

const env = {
  DB: process.env.CLOUDFLARE_API_TOKEN ? db : undefined,
  CHAT_ROOM: chatRoom,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  PAIRING_HMAC_KEY: process.env.PAIRING_HMAC_KEY,
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
  TIKTOK_CONNECTOR_INGEST_SECRET: process.env.TIKTOK_CONNECTOR_INGEST_SECRET,
  ALLOW_REMOTE_DEV_AUTH: process.env.ALLOW_REMOTE_DEV_AUTH || "true",
  APP_BASE_URL: process.env.APP_BASE_URL || "https://riftpulse-dev.chrismeten0.workers.dev",
  TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS || "https://riftpulse-dev.chrismeten0.workers.dev",
  TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
  TWITCH_REDIRECT_URI: process.env.TWITCH_REDIRECT_URI,
  TWITCH_EVENTSUB_SECRET: process.env.TWITCH_EVENTSUB_SECRET,
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REDIRECT_URI: process.env.YOUTUBE_REDIRECT_URI,
  KICK_CLIENT_ID: process.env.KICK_CLIENT_ID,
  KICK_CLIENT_SECRET: process.env.KICK_CLIENT_SECRET,
  KICK_REDIRECT_URI: process.env.KICK_REDIRECT_URI,
};

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(", "));
      else if (value !== undefined) headers.set(name, value);
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": process.env.TRUSTED_ORIGINS || "https://riftpulse-dev.chrismeten0.workers.dev",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
        "vary": "Origin",
      });
      return res.end();
    }
    const init = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") { init.body = req; init.duplex = "half"; }
    const response = await worker.fetch(new Request(requestUrl, init), env);
    const responseHeaders = new Headers(response.headers);
    const origin = req.headers.origin;
    const trusted = (process.env.TRUSTED_ORIGINS || "https://riftpulse-dev.chrismeten0.workers.dev").split(",").map(x => x.trim());
    if (origin && trusted.includes(origin)) {
      responseHeaders.set("access-control-allow-origin", origin);
      responseHeaders.set("access-control-allow-credentials", "true");
      responseHeaders.append("vary", "Origin");
    }
    res.writeHead(response.status, Object.fromEntries(responseHeaders.entries()));
    if (req.method === "HEAD" || response.status === 204 || response.status === 304) return res.end();
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("request_failed", error instanceof Error ? error.message : "unknown");
    if (!res.headersSent) res.writeHead(500, JSON_HEADERS);
    res.end(JSON.stringify({ error: { code: "internal_error", message: "The API could not complete the request." } }));
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const origin = req.headers.origin;
    const trusted = (process.env.TRUSTED_ORIGINS || "https://riftpulse-dev.chrismeten0.workers.dev").split(",").map(x => x.trim());
    if (url.pathname !== "/api/v1/realtime" || !origin || !trusted.includes(origin)) return socket.destroy();
    const auth = createAuth(env);
    if (!auth) return socket.destroy();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(", "));
      else if (value !== undefined) headers.set(name, value);
    }
    const session = await auth.api.getSession({ headers });
    const accountId = session?.user?.id;
    if (!accountId) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!socketsByAccount.has(accountId)) socketsByAccount.set(accountId, new Set());
      const sockets = socketsByAccount.get(accountId);
      sockets.add(ws);
      ws.on("close", () => {
        sockets.delete(ws);
        if (sockets.size === 0) socketsByAccount.delete(accountId);
      });
    });
  } catch { socket.destroy(); }
});

server.listen(PORT, "0.0.0.0", () => console.log(`RiftPulse Railway API listening on ${PORT}`));
