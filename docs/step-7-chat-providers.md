# Step 7 — Chat and providers

Status: **in progress**. Chat ingestion primitives, signed Twitch/Kick webhook receivers, realtime fan-out, provider status APIs, and the Twitch OAuth authorization-code foundation are implemented locally. Real provider credentials and end-to-end external testing are still required.

## Implemented locally

- Shared normalized message and provider-health types; Twitch EventSub, YouTube Live Chat, and Kick payload normalizers.
- Bounded TTL deduplication and full-jitter reconnect backoff helper.
- Viewer aggregation includes only fresh counts from connected/degraded providers. Unknown remains `null`, not zero; partial availability is explicit.
- D1 migration `0003_chat_foundation.sql` adds `chat_messages`, per-account/provider/external-message uniqueness, a recent-message index, and a separate viewer-count freshness timestamp.
- D1 migration `0004_provider_oauth_states.sql` stores only a SHA-256 digest of high-entropy, short-lived OAuth state and supports single-use consumption.
- AES-256-GCM token vault with random nonces and authenticated ciphertext; token persistence helpers never store raw provider access/refresh tokens.
- Twitch OAuth authorization-code start and callback: trusted-Origin check, HttpOnly/SameSite state cookie, one-time server-side state, exact same-origin callback validation, token exchange, Twitch token validation, required chat scope validation, encrypted token persistence, and health marked degraded until EventSub subscriptions exist.
- Authenticated `GET /api/v1/providers/connections` returns safe status/display metadata only; authenticated `DELETE /api/v1/providers/{provider}` clears stored token ciphertext.
- Signed Twitch EventSub callback handles challenge verification, chat notifications, and revocation; signed Kick webhook handles version 1 `chat.message.sent`. Both route only to mapped connected channels and persist idempotently.
- Per-account Durable Object WebSocket fan-out and authenticated `GET /api/v1/realtime` endpoint with trusted-Origin enforcement.
- Website Recent chat and Provider health panels consume the local APIs and realtime events. Provider status is no longer a simulated connected/disconnected toggle.
- Local migrations, unit tests, authentication integration, and production-mode build validated.

## Remaining before Step 7 is complete

1. Register/configure the Twitch developer app locally and test the real OAuth round trip; no client credentials are present in the template.
2. Implement Twitch EventSub subscription creation, token refresh/validation lifecycle, and reconnect/revocation recovery.
3. Implement YouTube OAuth, live-chat discovery, streaming/list fallback, quota-aware polling, and viewer-count collection.
4. Implement Kick OAuth, subscription creation, channel mapping validation, and real end-to-end webhook tests.
5. Connect PCVR/Quest mod clients to the authenticated realtime endpoint in their separate game-specific adapters.
6. Add real viewer-count collection for supported providers and verify freshness/partial counts end to end.
7. Evaluate TikTok LIVE separately; do not scrape undocumented/private endpoints or claim support without a compliant connector.
8. Add provider mock/integration tests for the complete OAuth and event delivery paths.

## Local OAuth configuration

Copy the example variable names into a local-only `.dev.vars` file and replace placeholders with credentials you own. Register the exact callback URL `http://127.0.0.1:5173/api/v1/providers/twitch/callback` for local testing. Generate a separate random 32-byte Base64 token-encryption key and a separate 10–100 character ASCII EventSub secret. Never commit `.dev.vars` or use these local values in production.

Twitch OAuth uses the official authorization-code flow and validates the resulting access token before storage. The webhook-based chat subscription requests `user:read:chat`, `user:bot`, and `channel:bot`, because Twitch requires an app access token for webhook subscriptions and the appropriate chat-user/broadcaster permissions. Token storage is encrypted; provider tokens are never returned by the status API. See the [official Twitch OAuth documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth), [EventSub subscription management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/), and [EventSub webhook verification guide](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

## Current limitations

- OAuth routes are ready for local configuration but have not completed a real Twitch authorization, because no Twitch app credentials are configured in this workspace.
- Twitch OAuth success alone does not deliver chat. The guarded EventSub subscription-creation endpoint is implemented, but it requires a public HTTPS development hostname and a real Twitch app before live verification can be tested.
- YouTube and Kick connection buttons remain disabled until their secure authorization flows are implemented.
- TikTok remains unavailable/unofficial until a compliant, maintainable live-chat path is verified.
- No production Cloudflare resources, remote D1, DNS, OAuth app registrations, or deployments have been changed.
