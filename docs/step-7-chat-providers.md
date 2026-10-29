# Step 7 — Chat and providers

Status: **in progress**. The local chat data model, message normalizers, dedupe/backoff helpers, viewer-count aggregation, authenticated read APIs, and dashboard display are implemented. Real provider transports and OAuth are not complete.

## Implemented locally

- Shared normalized message and provider-health types.
- Normalizers for Twitch EventSub chat events, YouTube Live Chat message resources, and Kick chat-message payloads.
- Bounded in-memory message deduplication and full-jitter exponential reconnect delay helper.
- Viewer aggregation includes only fresh counts from connected/degraded providers. Unknown remains `null`, not zero; partial availability is explicit.
- D1 migration `0003_chat_foundation.sql` adds `chat_messages`, per-account/provider/external-message uniqueness, a recent-message index, and a separate `viewer_count_observed_at` timestamp.
- A D1 persistence helper stores normalized messages without retaining raw provider payloads.
- A tested AES-256-GCM provider-token vault helper uses random nonces and authenticated ciphertext envelopes; OAuth/token storage does not use it yet because provider OAuth setup is still gated.
- Twitch EventSub webhook verification using the configured HMAC-SHA256 secret, exact raw body, and freshness window; handles signed challenge verification, chat notifications, and revocation status updates.
- Kick webhook verification using the current official public-key endpoint, RSA-SHA256 signature over the message ID, timestamp, and exact raw body; rejects stale signatures, caps body size, and does not log payloads or signatures.
- Signed `POST /api/v1/providers/twitch/webhook` and `POST /api/v1/providers/kick/webhook` receivers. Twitch handles EventSub challenge/notification/revocation messages; Kick handles version 1 `chat.message.sent`. Both route only to mapped connected channels, persist idempotently, and do not falsely refresh viewer counts.
- Authenticated `GET /api/v1/chat/messages` and `GET /api/v1/integrations/health` endpoints.
- Per-account Durable Object WebSocket room and authenticated `GET /api/v1/realtime` route with trusted-Origin enforcement.
- Valid Twitch and Kick chat events are forwarded to the account's realtime room after successful idempotent persistence; delivery is best-effort.
- Dashboard Recent chat panel applies incoming realtime events and reconnects after disconnection.
- Dashboard Provider health panel with honest empty states and unknown viewer counts.
- The new schema migration is present in the local migration ledger and the local database has the chat table and viewer freshness column.

## Remaining before Step 7 is complete

1. Implement OAuth and encrypted token lifecycle for Twitch, YouTube, and Kick.
2. Implement Twitch EventSub connection/subscription setup and reconnect recovery.
3. Implement YouTube live-chat discovery, streaming/list fallback, quota-aware polling, and reconnect handling.
4. Finish Kick OAuth, webhook subscription setup, channel mapping validation, and live end-to-end tests for the implemented signed receiver.
5. Connect the PCVR/Quest mod clients to the authenticated realtime endpoint in their separate game-specific adapters.
6. Add real provider viewer-count collection and update the provider-health rows with correct freshness timestamps.
7. Evaluate TikTok LIVE separately. Do not scrape undocumented/private endpoints or claim it is supported without a compliant connector.
8. Add provider mock/integration tests and rerun local validation.

## Current limitations

- Provider cards remain preview-only and do not authorize accounts.
- The website connects to realtime and Kick can publish signed events; PCVR/Quest mod clients still need their adapters, and Twitch/YouTube ingestion remains incomplete.
- TikTok remains unsupported/unofficial until a compliant, maintainable live-chat path is verified.
- No Cloudflare production resources, remote D1, DNS, OAuth app registrations, or deployments have been changed.
