-- Step 7 chat history and provider viewer-count freshness.
ALTER TABLE integration_health ADD COLUMN viewer_count_observed_at TEXT;

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('twitch', 'youtube', 'kick', 'tiktok')),
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
CREATE INDEX IF NOT EXISTS idx_chat_messages_recent ON chat_messages(account_id, received_at DESC);
