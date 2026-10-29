-- Per-account provider configuration that is not an OAuth connection.
CREATE TABLE IF NOT EXISTS provider_settings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('tiktok')),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider)
);