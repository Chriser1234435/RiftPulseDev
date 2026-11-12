-- Permanently retire Kick: remove its records and tighten provider CHECK constraints.
-- Preserve all records for Twitch, YouTube, and TikTok while removing Kick PKCE state storage.

CREATE TABLE provider_oauth_states_new (
  state_digest TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
INSERT INTO provider_oauth_states_new (state_digest, account_id, provider, created_at, expires_at, consumed_at)
SELECT state_digest, account_id, provider, created_at, expires_at, consumed_at
FROM provider_oauth_states WHERE provider <> 'kick';
DROP TABLE provider_oauth_states;
ALTER TABLE provider_oauth_states_new RENAME TO provider_oauth_states;
CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_expiry ON provider_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_provider_oauth_states_account ON provider_oauth_states(account_id, provider, consumed_at);

CREATE TABLE provider_connections_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'tiktok')),
  external_account_id TEXT,
  display_name TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'expired', 'degraded', 'error')),
  connected_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, provider)
);
INSERT INTO provider_connections_new
SELECT * FROM provider_connections WHERE provider <> 'kick';
DROP TABLE provider_connections;
ALTER TABLE provider_connections_new RENAME TO provider_connections;
CREATE INDEX IF NOT EXISTS idx_provider_connections_status ON provider_connections(account_id, status);

CREATE TABLE integration_health_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'tiktok')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'disconnected', 'error')),
  viewer_count INTEGER CHECK (viewer_count IS NULL OR viewer_count >= 0),
  observed_at TEXT NOT NULL,
  detail_code TEXT,
  viewer_count_observed_at TEXT,
  UNIQUE (account_id, provider)
);
INSERT INTO integration_health_new
SELECT * FROM integration_health WHERE provider <> 'kick';
DROP TABLE integration_health;
ALTER TABLE integration_health_new RENAME TO integration_health;
CREATE INDEX IF NOT EXISTS idx_integration_health_observed ON integration_health(account_id, observed_at);

CREATE TABLE chat_messages_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'tiktok')),
  external_message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  sent_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  badges_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (account_id, provider, external_message_id)
);
INSERT INTO chat_messages_new
SELECT * FROM chat_messages WHERE provider <> 'kick';
DROP TABLE chat_messages;
ALTER TABLE chat_messages_new RENAME TO chat_messages;
CREATE INDEX IF NOT EXISTS idx_chat_messages_recent ON chat_messages(account_id, received_at DESC);

CREATE TABLE provider_events_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'tiktok')),
  external_event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('follow', 'subscription', 'gift', 'bits', 'super_chat', 'donation', 'like', 'share', 'raid', 'member_join', 'viewer_count', 'other')),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  message TEXT,
  item_name TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  amount REAL CHECK (amount IS NULL OR amount >= 0),
  currency TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (account_id, provider, external_event_id)
);
INSERT INTO provider_events_new
SELECT * FROM provider_events WHERE provider <> 'kick';
DROP TABLE provider_events;
ALTER TABLE provider_events_new RENAME TO provider_events;
CREATE INDEX IF NOT EXISTS idx_provider_events_recent ON provider_events(account_id, received_at DESC);

CREATE TABLE song_requests_new (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'tiktok')),
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  beatsaver_key TEXT,
  song_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'playing', 'played', 'rejected', 'failed')),
  result_code TEXT,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO song_requests_new
SELECT * FROM song_requests WHERE provider <> 'kick';
DROP TABLE song_requests;
ALTER TABLE song_requests_new RENAME TO song_requests;
CREATE INDEX IF NOT EXISTS idx_song_requests_queue ON song_requests(account_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_song_requests_requester ON song_requests(account_id, requester_id, requested_at);

DELETE FROM provider_settings WHERE provider = 'kick';
