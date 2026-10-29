-- Per-account cursor for polling the currently active YouTube Live Chat.
CREATE TABLE IF NOT EXISTS youtube_live_chat_cursors (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  live_chat_id TEXT NOT NULL,
  next_page_token TEXT,
  updated_at TEXT NOT NULL
);
