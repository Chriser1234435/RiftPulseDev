-- BSR runtime queue indexes. Active map duplicates are prevented per account while
-- allowing the same map to be requested again after it has been played or removed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_song_requests_active_map
  ON song_requests(account_id, beatsaver_key)
  WHERE beatsaver_key IS NOT NULL AND status IN ('queued', 'playing');

CREATE INDEX IF NOT EXISTS idx_song_requests_history
  ON song_requests(account_id, requested_at DESC);
