# RiftPulse shared runtime helpers

Shared code used by the Worker and later integration tests. Pairing helpers store a keyed HMAC digest of a mod-generated five-digit code rather than storing the code itself. The HMAC key must be a strong, local-only secret and must never be committed.
