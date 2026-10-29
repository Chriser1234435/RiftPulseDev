# Step 7 — Chat and providers

Status: **in progress**. Chat ingestion primitives, signed Twitch/Kick webhook receivers, realtime fan-out, provider status APIs, and Twitch/YouTube OAuth foundations are implemented locally. Real provider credentials and end-to-end external testing are still required.

## Implemented locally

- Shared normalized chat-message and provider-health types; Twitch EventSub, YouTube Live Chat, Kick, and TikTok chat payload normalizers. Added a cross-platform provider-event contract for follows, subscriptions, gifts, Bits, Super Chats, donations, likes, shares, raids, joins, and viewer-count events.
- Bounded TTL deduplication and full-jitter reconnect backoff helper.
- Viewer aggregation includes only fresh counts from connected/degraded providers. Unknown remains `null`, not zero; partial availability is explicit.
- D1 migration `0003_chat_foundation.sql` adds `chat_messages`, per-account/provider/external-message uniqueness, a recent-message index, and a separate viewer-count freshness timestamp.
- D1 migration `0004_provider_oauth_states.sql` stores only a SHA-256 digest of high-entropy, short-lived OAuth state and supports single-use consumption.
- AES-256-GCM token vault with random nonces and authenticated ciphertext; token persistence helpers never store raw provider access/refresh tokens.
- On-demand Twitch token lifecycle helper validates access tokens, refreshes expired/near-expiry tokens, validates the rotated token and required scopes, and persists rotated tokens encrypted.
- Twitch OAuth authorization-code start and callback: trusted-Origin check, HttpOnly/SameSite state cookie, one-time server-side state, exact same-origin callback validation, token exchange, Twitch token validation, required chat scope validation, encrypted token persistence, and health marked degraded until EventSub subscriptions exist.
- YouTube OAuth authorization-code start and callback: trusted-Origin check, HttpOnly/SameSite state cookie, one-time server-side state, offline access request, read-only scope validation, YouTube channel identity lookup, encrypted token persistence, and honest degraded health until live-chat polling is implemented.
- Kick OAuth 2.1 authorization-code start/callback with PKCE S256, encrypted short-lived verifier storage, one-time state, token introspection, required scope validation, user identity lookup, encrypted token persistence, and degraded health until webhook subscription setup is complete.
- Authenticated `GET /api/v1/providers/connections` returns safe status/display metadata only; authenticated `DELETE /api/v1/providers/{provider}` clears stored token ciphertext.
- Signed Twitch EventSub callback handles challenge verification, chat notifications, and revocation; signed Kick webhook handles version 1 `chat.message.sent`. Both route only to mapped connected channels and persist idempotently.
- Per-account Durable Object WebSocket fan-out and authenticated `GET /api/v1/realtime` endpoint with trusted-Origin enforcement.
- Website Recent chat and Provider health panels consume the local APIs and realtime events. Provider status is no longer a simulated connected/disconnected toggle.
- Local migrations, unit tests, authentication integration, and production-mode build validated.

## Remaining before Step 7 is complete

1. Register/configure the Twitch developer app locally and test the real OAuth round trip; no client credentials are present in the template.
2. Add scheduled Twitch token refresh, subscription recovery/reconciliation, and revocation recovery; the on-demand refresh helper and subscription-creation endpoint are implemented.
3. Implement YouTube live-chat discovery, streaming/list fallback, quota-aware polling, token refresh, and viewer-count collection; OAuth foundation is present but has not completed a real round trip.
4. Implement Kick webhook subscription creation, channel mapping validation, token refresh/recovery, and real end-to-end webhook tests; the PKCE OAuth foundation is present but has not completed a real round trip.
5. Connect PCVR/Quest mod clients to the authenticated realtime endpoint in their separate game-specific adapters.
6. Add real viewer-count collection for supported providers and verify freshness/partial counts end to end.
7. Run a real TikTok LIVE stream through the isolated Node.js bridge, verify reconnect/recovery and event payload shapes, and document its best-effort behavior. Do not store TikTok login cookies or credentials, and do not treat gift/diamond counts as cash donations.
8. Normalize and route platform-specific non-chat events from Twitch EventSub, YouTube Live Chat, and Kick webhooks into the shared provider-event table and realtime feed.
9. Add provider mock/integration tests for the complete OAuth and event delivery paths.

## Local OAuth configuration

Copy the example variable names into a local-only `.dev.vars` file and replace placeholders with credentials you own. Register the exact local callback URLs `http://127.0.0.1:5173/api/v1/providers/twitch/callback`, `http://127.0.0.1:5173/api/v1/providers/youtube/callback`, and `http://127.0.0.1:5173/api/v1/providers/kick/callback` with their respective provider apps. Generate a separate random 32-byte Base64 token-encryption key, a separate 10–100 character ASCII Twitch EventSub secret, and keep all client secrets private. Kick uses PKCE S256; the short-lived verifier is encrypted in the local OAuth-state table. Never commit `.dev.vars` or use these local values in production.

Twitch OAuth uses the official authorization-code flow and validates the resulting access token before storage. The webhook-based chat subscription requests `user:read:chat`, `user:bot`, and `channel:bot`, because Twitch requires an app access token for webhook subscriptions and the appropriate chat-user/broadcaster permissions. Token storage is encrypted; provider tokens are never returned by the status API. See the [official Twitch OAuth documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth), [EventSub subscription management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/), and [EventSub webhook verification guide](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

## Current limitations

- OAuth routes are ready for local configuration but have not completed a real Twitch authorization, because no Twitch app credentials are configured in this workspace.
- Twitch OAuth success alone does not deliver chat. The guarded EventSub subscription-creation endpoint is implemented, but it requires a public HTTPS development hostname and a real Twitch app before live verification can be tested.
- YouTube OAuth is implemented locally but requires Google OAuth credentials; live-chat polling and viewer counts remain unfinished. Kick OAuth is implemented locally but requires Kick app credentials; webhook subscription setup and live validation remain unfinished.
- TikTok uses an isolated unofficial Node.js bridge (`services/tiktok-bridge`), signed HMAC/timestamp-bounded ingestion, normalized chat/event persistence, and realtime event fan-out. It is best-effort; the live connector has not been run against a live stream yet.
- No production Cloudflare resources, remote D1, DNS, OAuth app registrations, or deployments have been changed.
