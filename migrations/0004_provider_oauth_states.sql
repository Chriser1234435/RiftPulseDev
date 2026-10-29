-- Short-lived, single-use OAuth state. Only a digest is stored; the raw state stays in the browser's HttpOnly cookie and authorization URL.
CREATE TABLE IF NOT EXISTS provider_oauth_states (
  state_digest TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expiry ON provider_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_account ON provider_oauth_states(account_id, provider, consumed_at);
