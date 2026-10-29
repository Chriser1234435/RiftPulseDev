# RiftPulseDev - Proposed Roadmap

Status: Step 6 local website/auth foundation complete. Step 7 chat/provider foundation is in progress. Production authentication and deployment remain gated on separate release checks and explicit authorization.

## Step 3 - Architecture and design
- [x] Define V1 scope: Chat + BSR Song Request only.
- [x] Define Cloudflare-first website/API, D1 persistence, and Durable Object realtime coordination.
- [x] Define no-Clerk auth direction and compatibility validation gate.
- [x] Define separate PCVR/Quest adapters and versioned API contracts.
- [x] Define mod-generated five-digit, short-lived, one-time pairing.
- [x] Define Twitch, YouTube, Kick, and isolated unofficial TikTok connector behavior.
- [x] Define security, UI, reliability, and test requirements.
- [x] User approved the architecture.

## Step 4 - Toolchain and clean repository foundation
- [x] Establish the clean local RiftPulseDev workspace without importing legacy source, migrations, secrets, or deployment config.
- [x] Verify Git, Node, Cloudflare toolchain, and local Worker build.
- [x] Verify PCVR loader/framework and compile a minimal .NET Framework 4.7.2 smoke project.
- [x] Install QPM/NDK/CMake/Ninja/ADB and compile a minimal Scotland2/QPM-based Quest ARM64 smoke project.
- [x] Record user-confirmed PCVR and Quest target version 1.40.8_7379.
- [x] Keep local commits unpushed and production resources unchanged.
- [ ] Runtime-test mod loading inside Beat Saber when a prepared mod and the relevant game/device are available.

## Step 5 - API contracts and persistence
- [x] Add shared V1 API contracts for the two modules, providers, pairing, commands, and song requests.
- [x] Add the initial D1 schema and local-only migration workflow.
- [x] Add health/version and pairing challenge/status endpoints.
- [x] Add HMAC-based code digest storage, five-minute expiry, active collision checks, and per-device challenge limits.
- [x] Add one-time claim helper and authenticated claim route.
- [x] Add authenticated module settings, device listing and revocation routes with origin checks for mutations.
- [x] Validate TypeScript, unit tests, isolated schema constraints, local migrations, and Worker build.

## Step 6 - Website and authentication (local foundation complete)
- [x] Build responsive dark RiftPulse dashboard and sign-in/account screens.
- [x] Add sign-up/sign-in using Better Auth, local-only D1 schema, session lookup and sign-out.
- [x] Persist module toggles and BSR command settings per account.
- [x] Add device pairing, device listing and revocation UI/API.
- [x] Add provider connection UI with API-backed status and credential-gated Twitch/YouTube OAuth actions.
- [x] Test session cookie flags, origin checks, settings persistence, pairing claim, device list/revoke, and sign-out.
- [x] Visually review the entry screen at desktop and narrow layout sizes; adjust mobile breakpoint.
- [x] Ensure build output removes .dev.vars copies after bundling.
- [ ] Production email verification and production-safe origin/cookie configuration remain release gates; remote authentication stays disabled.

## Step 7 - Chat and providers (in progress)
- [x] Add shared normalized chat message and provider health contracts.
- [x] Add signed Twitch EventSub callback handling for challenge verification, chat notifications, and revocation, plus OAuth/subscription setup routes; live verification still requires credentials and HTTPS.
- [x] Add normalizers for Twitch EventSub, YouTube Live Chat, Kick, and TikTok chat payloads plus a shared provider-event contract.
- [x] Add bounded TTL deduplication and full-jitter reconnect backoff helpers.
- [x] Aggregate only fresh provider viewer counts; unknown stays null and partial data is explicit.
- [x] Add D1 chat message persistence with per-account/provider/message uniqueness and viewer-count freshness.
- [x] Add tested AES-256-GCM provider-token vault and encrypted provider-token persistence helpers.
- [x] Add authenticated chat-history, provider-health and connection-status APIs plus dashboard chat/provider-health display; remove fake provider connection toggles.
- [x] Implement signed Kick webhook verification and idempotent ingestion for version 1 chat.message.sent events.
- [x] Apply the chat foundation migration to the local D1 database and extend schema/unit tests.
- [x] Add Twitch OAuth authorization-code start/callback, one-time state, token validation, encrypted token storage, connection status API, and disconnect endpoint.
- [x] Add guarded Twitch EventSub subscription creation with app access tokens and signed HTTPS webhook verification; health only becomes healthy after an enabled subscription or signed callback challenge.
- [x] Add on-demand Twitch access-token validation and refresh with encrypted rotated-token persistence.
- [ ] Add scheduled refresh/recovery and pagination-aware subscription reconciliation.
- [x] Add Google OAuth authorization-code start/callback, offline refresh-token request, YouTube channel identification, and encrypted token storage.
- [ ] Implement YouTube Live Chat discovery, streaming/list fallback, quota-aware polling, token refresh, and viewer counts.
- [x] Add Kick OAuth 2.1 authorization-code start/callback with PKCE S256, encrypted verifier state, token introspection, required scope validation, and encrypted token storage.
- [ ] Implement Kick webhook subscription creation, channel mapping validation, token refresh/recovery, and real end-to-end tests.
- [x] Add per-account Durable Object WebSocket fan-out for the website and future PCVR/Quest clients.
- [ ] Add realtime connection to PCVR/Quest mod clients in the mod integration step.
- [x] Add an isolated Node.js TikTok LIVE bridge with HMAC-signed, timestamp-bounded ingest, normalized chat/event persistence, and realtime provider-event fan-out; live-stream verification remains outstanding.
- [ ] Run provider mock/integration tests and verify fresh viewer counts end to end.
- [x] Replace fake provider preview toggles with API-backed status and credential-gated Twitch/YouTube/Kick OAuth actions.

## Step 8 - BSR Song Request (not started)
Implement command parsing, BeatSaver metadata validation, cooldowns, queue rules, and explicit error states.

## Step 9 - PCVR and Quest integration (not started)
Build the in-game pairing flow and UI for each target; test them separately on actual devices.

## Step 10 - End-to-end validation and deployment (not started)
Run security, API, provider-mock, PCVR, and Quest tests. Deploy only to isolated Cloudflare development resources and a development hostname after explicit authorization. Test the actual development domain, not only previews.

## V1 acceptance criteria
- Pairing uses a mod-generated five-digit code with short expiry and single use.
- PCVR and Quest can connect and show clear status.
- All four provider connectors report honest health; TikTok is clearly marked unofficial/best-effort.
- Chat messages normalize and display correctly; viewer total indicates partial data when needed.
- Configured chat commands can enqueue valid BSR requests with cooldowns and explicit failures.
- Settings persist and device/provider disconnection works.
- No Clerk, no legacy code import, no secrets committed, and no email/DNS disruption.
