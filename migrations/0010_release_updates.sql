-- Persistent release notes shared across website and mod releases.
CREATE TABLE IF NOT EXISTS release_updates (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  category TEXT NOT NULL CHECK (category IN ('website', 'mod', 'both')),
  version TEXT,
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
  changes_json TEXT NOT NULL DEFAULT '[]',
  published_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_updates_published
  ON release_updates(published_at DESC);

CREATE TABLE IF NOT EXISTS release_update_reads (
  account_id TEXT NOT NULL,
  update_id TEXT NOT NULL REFERENCES release_updates(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (account_id, update_id)
);
CREATE INDEX IF NOT EXISTS idx_release_update_reads_account
  ON release_update_reads(account_id, read_at DESC);
