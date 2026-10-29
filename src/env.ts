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
  /** Twitch EventSub webhook HMAC secret (10–100 chars); never commit the value. */
  TWITCH_EVENTSUB_SECRET?: string;
  /** Canonical base URL for auth redirects and cookies. Local development only in Step 6. */
  APP_BASE_URL?: string;
  /** Comma-separated exact trusted browser origins. */
  TRUSTED_ORIGINS?: string;
}
