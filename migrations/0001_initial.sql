-- RiftPulseDev V1 initial schema. Local-first; apply remotely only after explicit authorization.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('pcvr', 'quest')),
  game_version TEXT NOT NULL,
  mod_version TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_account_created ON devices(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_devices_active ON devices(account_id, revoked_at);

CREATE TABLE IF NOT EXISTS pairing_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('pcvr', 'quest')),
  game_version TEXT NOT NULL,
  mod_version TEXT NOT NULL,
  code_digest TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'expired', 'revoked', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pairing_device_status ON pairing_challenges(device_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_expiry ON pairing_challenges(status, expires_at);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick', 'tiktok')),
  external_account_id TEXT,
  display_name TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected', 'expired', 'degraded', 'error')),
  connected_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_provider_connections_status ON provider_connections(account_id, status);

CREATE TABLE IF NOT EXISTS module_settings (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL CHECK (module_key IN ('chat', 'bsr-song-request')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, module_key)
);

CREATE TABLE IF NOT EXISTS chat_commands (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  command_key TEXT NOT NULL,
  module_key TEXT NOT NULL CHECK (module_key IN ('chat', 'bsr-song-request')),
  action TEXT NOT NULL CHECK (action IN ('reply', 'request-song')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  cooldown_ms INTEGER NOT NULL DEFAULT 5000 CHECK (cooldown_ms BETWEEN 0 AND 86400000),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, command_key),
  CHECK (length(command_key) BETWEEN 1 AND 32),
  CHECK (substr(command_key, 1, 1) = '!')
);
CREATE INDEX IF NOT EXISTS idx_chat_commands_enabled ON chat_commands(account_id, enabled, module_key);

CREATE TABLE IF NOT EXISTS song_requests (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick', 'tiktok')),
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  beatsaver_key TEXT,
  song_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'playing', 'played', 'rejected', 'failed')),
  result_code TEXT,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_requests_queue ON song_requests(account_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_song_requests_requester ON song_requests(account_id, requester_id, requested_at);

CREATE TABLE IF NOT EXISTS integration_health (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick', 'tiktok')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'disconnected', 'error')),
  viewer_count INTEGER CHECK (viewer_count IS NULL OR viewer_count >= 0),
  observed_at TEXT NOT NULL,
  detail_code TEXT,
  UNIQUE (account_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_integration_health_observed ON integration_health(account_id, observed_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  operation TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (account_id, key, operation)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);
