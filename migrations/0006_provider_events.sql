-- Normalized stream events, separate from ordinary chat messages.
CREATE TABLE IF NOT EXISTS provider_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick', 'tiktok')),
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
CREATE INDEX IF NOT EXISTS idx_provider_events_recent ON provider_events(account_id, received_at DESC);
