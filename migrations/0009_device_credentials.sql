-- Store only a digest of each installation credential; pairing challenges carry it temporarily.
ALTER TABLE devices ADD COLUMN credential_digest TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_credential_digest
  ON devices(credential_digest) WHERE credential_digest IS NOT NULL;

ALTER TABLE pairing_challenges ADD COLUMN device_credential_digest TEXT;
