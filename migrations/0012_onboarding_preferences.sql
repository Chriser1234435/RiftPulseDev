-- Per-account guided onboarding state.
-- Existing accounts are marked complete by default so long-dormant users are not surprised.
-- Accounts with a valid session at rollout are opted into the one-time walkthrough.
-- Accounts created after this migration receive the pending default from the API.
CREATE TABLE IF NOT EXISTS account_preferences (
  account_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL CHECK (length(preference_key) BETWEEN 1 AND 64),
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, preference_key)
);
CREATE INDEX IF NOT EXISTS idx_account_preferences_updated
  ON account_preferences(account_id, updated_at DESC);

INSERT OR IGNORE INTO account_preferences (account_id, preference_key, value_json, updated_at)
SELECT id, 'onboarding_v1', '{"completed":true,"source":"legacy_account"}', datetime('now')
FROM user;

UPDATE account_preferences
SET value_json = '{"completed":false,"source":"rollout_active_session"}', updated_at = datetime('now')
WHERE preference_key = 'onboarding_v1'
  AND account_id IN (SELECT DISTINCT userId FROM session WHERE expiresAt > (unixepoch() * 1000));
