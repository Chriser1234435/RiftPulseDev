/** Minimal structural types for the D1 operations used by this Worker. */
export interface D1Meta { changes?: number; duration?: number; last_row_id?: number; }
export interface D1Result<T = Record<string, unknown>> {
  success: boolean; results?: T[]; meta?: D1Meta; error?: string;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
export interface Env {
  DB?: D1Database;
  CHAT_ROOM?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Set with a local-only .dev.vars file or Wrangler secret; never commit the value. */
  PAIRING_HMAC_KEY?: string;
  /** Separate Better Auth signing key. Never reuse the pairing key. */
  BETTER_AUTH_SECRET?: string;
  /** Twitch OAuth application client ID. */
  TWITCH_CLIENT_ID?: string;
  /** Twitch OAuth application client secret; never commit the value. */
  TWITCH_CLIENT_SECRET?: string;
  /** Exact registered Twitch OAuth callback URI. */
  TWITCH_REDIRECT_URI?: string;
  /** Twitch EventSub webhook HMAC secret (10–100 chars); never commit the value. */
  TWITCH_EVENTSUB_SECRET?: string;
  /** Google OAuth web client ID for YouTube read-only access. */
  YOUTUBE_CLIENT_ID?: string;
  /** Google OAuth web client secret; never commit the value. */
  YOUTUBE_CLIENT_SECRET?: string;
  /** Exact registered Google OAuth callback URI. */
  YOUTUBE_REDIRECT_URI?: string;
  /** Kick OAuth application client ID. */
  KICK_CLIENT_ID?: string;
  /** Kick OAuth application client secret; never commit the value. */
  KICK_CLIENT_SECRET?: string;
  /** Exact registered Kick OAuth callback URI. */
  KICK_REDIRECT_URI?: string;
  /** HMAC secret shared only with the isolated unofficial TikTok LIVE connector bridge. */
  TIKTOK_CONNECTOR_INGEST_SECRET?: string;
  /** Base64-encoded 32-byte AES-256-GCM key for provider tokens; never commit the value. */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Canonical base URL for auth redirects and cookies. Local development only in Step 6. */
  APP_BASE_URL?: string;
  /** Comma-separated exact trusted browser origins. */
  TRUSTED_ORIGINS?: string;
}
