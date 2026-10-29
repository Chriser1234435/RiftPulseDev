# Step 7 — Chat and providers

Status: **in progress**. The local chat data model, message normalizers, dedupe/backoff helpers, viewer-count aggregation, authenticated read APIs, and dashboard display are implemented. Real provider transports and OAuth are not complete.

## Implemented locally

- Shared normalized message and provider-health types.
- Normalizers for Twitch EventSub chat events, YouTube Live Chat message resources, and Kick chat-message payloads.
- Bounded in-memory message deduplication and full-jitter exponential reconnect delay helper.
- Viewer aggregation includes only fresh counts from connected/degraded providers. Unknown remains `null`, not zero; partial availability is explicit.
- D1 migration `0003_chat_foundation.sql` adds `chat_messages`, per-account/provider/external-message uniqueness, a recent-message index, and a separate `viewer_count_observed_at` timestamp.
- A D1 persistence helper stores normalized messages without retaining raw provider payloads.
- Authenticated `GET /api/v1/chat/messages` and `GET /api/v1/integrations/health` endpoints.
- Dashboard Recent chat and Provider health panel with honest empty states and unknown viewer counts.
- The new schema migration is present in the local migration ledger and the local database has the chat table and viewer freshness column.

## Remaining before Step 7 is complete

1. Implement OAuth and encrypted token lifecycle for Twitch, YouTube, and Kick.
2. Implement Twitch EventSub connection/subscription setup and reconnect recovery.
3. Implement YouTube live-chat discovery, streaming/list fallback, quota-aware polling, and reconnect handling.
4. Implement Kick webhook public-key/signature verification, subscription setup, channel mapping, and end-to-end tests.
5. Add Durable Object WebSocket fan-out so the website and PCVR/Quest clients can receive messages live.
6. Add real provider viewer-count collection and update the provider-health rows with correct freshness timestamps.
7. Evaluate TikTok LIVE separately. Do not scrape undocumented/private endpoints or claim it is supported without a compliant connector.
8. Add provider mock/integration tests and rerun local validation.

## Current limitations

- Provider cards remain preview-only and do not authorize accounts.
- The chat panel currently displays stored messages and provider status; it is not a live stream until provider ingestion and WebSocket fan-out are implemented.
- TikTok remains unsupported/unofficial until a compliant, maintainable live-chat path is verified.
- No Cloudflare production resources, remote D1, DNS, OAuth app registrations, or deployments have been changed.
