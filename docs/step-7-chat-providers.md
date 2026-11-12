# Step 7 — Chat and providers

Status: **in progress**. Chat ingestion primitives, signed Twitch EventSub receiver, realtime fan-out, provider status APIs, and Twitch/YouTube OAuth foundations are implemented locally. Real provider credentials and end-to-end external testing are still required.

## Implemented locally

- Shared normalized chat-message and provider-health types; Twitch EventSub, YouTube Live Chat, and TikTok chat normalizers. Added provider-event normalizers for Twitch EventSub, YouTube Super Chats/memberships, and TikTok LIVE events.
- Bounded TTL deduplication and full-jitter reconnect backoff helper.
- Viewer aggregation includes only fresh counts from connected/degraded providers. Unknown remains `null`, not zero; partial availability is explicit.
- D1 migration `0003_chat_foundation.sql` adds `chat_messages`, per-account/provider/external-message uniqueness, a recent-message index, and a separate viewer-count freshness timestamp.
- D1 migration `0004_provider_oauth_states.sql` stores only a SHA-256 digest of high-entropy, short-lived OAuth state and supports single-use consumption.
- AES-256-GCM token vault with random nonces and authenticated ciphertext; token persistence helpers never store raw provider access/refresh tokens.
- On-demand Twitch token lifecycle helper validates access tokens, refreshes expired/near-expiry tokens, validates the rotated token and required scopes, and persists rotated tokens encrypted.
- Twitch OAuth authorization-code start and callback: trusted-Origin check, HttpOnly/SameSite state cookie, one-time server-side state, exact same-origin callback validation, token exchange, Twitch token validation, required chat scope validation, encrypted token persistence, and health marked degraded until EventSub subscriptions exist.
- YouTube OAuth authorization-code start and callback: trusted-Origin check, HttpOnly/SameSite state cookie, one-time server-side state, offline access request, read-only scope validation, YouTube channel identity lookup, and encrypted token persistence. Authenticated on-demand polling now refreshes expired tokens, discovers the active broadcast/live-chat ID, pages messages, normalizes chat and Super Chat/membership events, persists idempotently, and publishes realtime frames.
- Authenticated `GET /api/v1/providers/connections` returns safe status/display metadata only; authenticated `DELETE /api/v1/providers/{provider}` clears stored token ciphertext.
- Signed Twitch EventSub callback handles challenge verification, chat messages, revocation, and normalized non-chat event notifications when subscriptions are configured. It routes only to mapped connected channels, persists events idempotently, and publishes realtime event frames.
- Per-account Durable Object WebSocket fan-out and authenticated `GET /api/v1/realtime` endpoint with trusted-Origin enforcement.
- Website Recent chat and Provider health panels consume the local APIs and realtime events. Provider status is no longer a simulated connected/disconnected toggle.
- Local migrations, unit tests, authentication integration, and production-mode build validated.

## Remaining before Step 7 is complete

1. Register/configure the Twitch developer app locally and test the real OAuth round trip; no client credentials are present in the template.
2. Add scheduled Twitch token refresh, subscription recovery/reconciliation, and revocation recovery; the on-demand refresh helper and subscription-creation endpoint are implemented.
3. Test the new authenticated YouTube live-chat polling against a real authorized live channel; improve retry behavior for expired page tokens and collect viewer counts where the API supports them.
5. Connect PCVR/Quest mod clients to the authenticated realtime endpoint in their separate game-specific adapters.
6. Add real viewer-count collection for supported providers and verify freshness/partial counts end to end.
7. Run a real TikTok LIVE stream through the isolated Node.js bridge, verify reconnect/recovery and event payload shapes, and document its best-effort behavior. Do not store TikTok login cookies or credentials, and do not treat gift/diamond counts as cash donations.
8. Add provider mock/integration tests for the YouTube polling route and the expanded Twitch EventSub subscription creation/delivery.
9. Run provider mock/integration tests and real end-to-end event delivery once local OAuth apps and live test channels are configured.

## Local OAuth configuration

Copy the example variable names into a local-only `.dev.vars` file and replace placeholders with credentials you own. Register the exact local callback URLs `http://127.0.0.1:5173/api/v1/providers/twitch/callback` and `http://127.0.0.1:5173/api/v1/providers/youtube/callback` with their respective provider apps. Generate a separate random 32-byte Base64 token-encryption key, a separate 10–100 character ASCII Twitch EventSub secret, and keep all client secrets private. Never commit `.dev.vars` or use these local values in production.

Twitch OAuth uses the official authorization-code flow and validates the resulting access token before storage. The Twitch OAuth flow requests `user:read:chat`, `user:bot`, `channel:bot`, `moderator:read:followers`, `channel:read:subscriptions`, and `bits:read`. The webhook-based subscription setup uses an app access token and attempts chat, follow, subscription, gifted-subscription, resubscription-message, and cheer EventSub subscriptions; Twitch must verify each callback before it is active. Token storage is encrypted; provider tokens are never returned by the status API. See the [official Twitch OAuth documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth), [EventSub subscription management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/), and [EventSub webhook verification guide](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

## Current limitations

- OAuth routes are ready for local configuration but have not completed a real Twitch authorization, because no Twitch app credentials are configured in this workspace.
- Twitch OAuth success alone does not deliver chat. The guarded EventSub subscription-creation endpoint is implemented, but it requires a public HTTPS development hostname and a real Twitch app before live verification can be tested.
- YouTube OAuth and authenticated on-demand live-chat polling are implemented locally but require Google OAuth credentials and a real active broadcast to validate. Polling happens only when the signed-in dashboard is opened/refreshed; there is no always-running local poller. Viewer-count collection remains unfinished.
- TikTok uses an isolated unofficial Node.js bridge (`services/tiktok-bridge`), signed HMAC/timestamp-bounded ingestion, normalized chat/event persistence, and realtime event fan-out. It is best-effort; the live connector has not been run against a live stream yet.
- No production Cloudflare resources, remote D1, DNS, OAuth app registrations, or deployments have been changed.


## Verification update — 2026-11-03 (Step 7 remains in progress)

- Re-ran the full `npm test` suite from the local RiftPulseDev checkout: TypeScript typecheck passed; all 41 unit/contract tests passed; the isolated SQLite migration integration test passed; and the Vite worker/client production-mode build completed successfully. The build script removed `.dev.vars` from its output.
- Re-ran the TikTok bridge TypeScript typecheck (`services/tiktok-bridge`, `npm run typecheck`): passed.
- Local OAuth configuration audit checked only key presence (no secret values printed): Twitch client ID/secret and EventSub secret, YouTube client ID/secret, Kick client ID/secret, and token encryption key are not configured in `.dev.vars`. Therefore real OAuth, EventSub subscription reconciliation/delivery, YouTube live-chat polling against an authorized live channel, and Kick webhook lifecycle tests remain unverified and cannot be honestly marked complete.
- Attempted `npm run test:auth:local` against the local Vite server. It failed at signup with HTTP 403 `INVALID_ORIGIN`. The local worker's effective trusted-origin configuration did not accept the smoke-test Origin; this is a test/configuration defect to resolve before claiming the auth integration smoke test passes. The local dev server was stopped after the attempt.
- No real TikTok LIVE session was available/started in this verification run; bridge payload/reconnect behavior is still only covered by code review and unit-level normalization/signature tests.

**Step 7 acceptance status: IN PROGRESS / BLOCKED on provider app credentials, approved live test channels/stream, and fixing the local auth smoke-test origin setup.** No production deployment, production DNS change, or production resource modification was performed.


### Follow-up auth integration verification — 2026-11-03

- Re-ran `npm run test:auth:local` with `RIFTPULSE_BASE_URL` set to the isolated Cloudflare development preview (`https://riftpulse-dev.chrismeten0.workers.dev`): **PASS**, exit code 0. Confirmed signup/session issuance, trusted-Origin/CSRF checks, module settings persistence, pairing claim/list/revoke, and sign-out. The test creates a temporary `.invalid` test account in the development environment; it did not touch production.
- This passes the integration flow on the intended dev preview. The direct localhost invocation still has the noted effective-origin mismatch and should be corrected as a separate local test harness/config item.
