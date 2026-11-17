-- Keep successfully downloaded requests in history without treating them as played.
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
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'playing', 'downloaded', 'played', 'rejected', 'failed')),
  result_code TEXT,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO song_requests_new
SELECT id, account_id, device_id, provider, requester_id, requester_name, raw_input,
       beatsaver_key, song_name, status, result_code, requested_at, updated_at
FROM song_requests;
DROP TABLE song_requests;
ALTER TABLE song_requests_new RENAME TO song_requests;
CREATE INDEX IF NOT EXISTS idx_song_requests_queue ON song_requests(account_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_song_requests_requester ON song_requests(account_id, requester_id, requested_at);
CREATE INDEX IF NOT EXISTS idx_song_requests_history ON song_requests(account_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_song_requests_active_map
ON song_requests(account_id, beatsaver_key)
WHERE beatsaver_key IS NOT NULL AND status IN ('queued', 'playing');
