# RiftPulseDev - Proposed Roadmap

Status: Step 6 local website/auth foundation complete. Step 7 chat/provider foundation is in progress. Step 9 PCVR pairing and Quest UI integration are in progress. Quest Alpha 0.1.16 is published to the isolated development site; alpha testers confirmed the package loaded normally as expected. Quest preview remains disconnected from pairing/API, persistent settings, live chat/viewer aggregation, and BSR. PCVR runtime validation and end-to-end pairing remain outstanding. Production authentication and deployment remain gated on separate release checks and explicit authorization.

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
- [x] Add normalizers for Twitch EventSub, YouTube Live Chat, and TikTok chat payloads plus a shared provider-event contract.
- [x] Add bounded TTL deduplication and full-jitter reconnect backoff helpers.
- [x] Aggregate only fresh provider viewer counts; unknown stays null and partial data is explicit.
- [x] Add D1 chat message persistence with per-account/provider/message uniqueness and viewer-count freshness.
- [x] Add tested AES-256-GCM provider-token vault and encrypted provider-token persistence helpers.
- [x] Add authenticated chat-history, provider-health and connection-status APIs plus dashboard chat/provider-health display; remove fake provider connection toggles.
- [x] Apply the chat foundation migration to the local D1 database and extend schema/unit tests.
- [x] Add Twitch OAuth authorization-code start/callback, one-time state, token validation, encrypted token storage, connection status API, and disconnect endpoint.
- [x] Add guarded Twitch EventSub subscription creation with app access tokens and signed HTTPS webhook verification; health only becomes healthy after an enabled subscription or signed callback challenge.
- [x] Add on-demand Twitch access-token validation and refresh with encrypted rotated-token persistence.
- [ ] Add scheduled refresh/recovery and pagination-aware subscription reconciliation.
- [x] Add Google OAuth authorization-code start/callback, offline refresh-token request, YouTube channel identification, and encrypted token storage.
- [ ] Implement YouTube Live Chat discovery, streaming/list fallback, quota-aware polling, token refresh, and viewer counts.
- [x] Add per-account Durable Object WebSocket fan-out for the website and future PCVR/Quest clients.
- [ ] Add realtime connection to PCVR/Quest mod clients in the mod integration step.
- [x] Add an isolated Node.js TikTok LIVE bridge with HMAC-signed, timestamp-bounded ingest, normalized chat/event persistence, and realtime provider-event fan-out; live-stream verification remains outstanding.
- [ ] Run provider mock/integration tests and verify fresh viewer counts end to end.
- [x] Replace fake provider preview toggles with API-backed status and credential-gated Twitch/YouTube OAuth actions.

## Step 8 - BSR Song Request (not started)
Implement command parsing, BeatSaver metadata validation, cooldowns, queue rules, and explicit error states.

## Step 9 - PCVR and Quest integration (in progress)
- [x] Add a BSIPA RiftPulse button registration for the PCVR main menu.
- [x] Add a dedicated PCVR FlowCoordinator and BSML pairing-screen prototype.
- [x] Add mod-generated five-digit pairing code generation and API challenge registration.
- [x] Compile PCVR adapter against the installed Beat Saber 1.40.8 / BSML assemblies (0 warnings, 0 errors) after pairing integration.
- [x] Register mod-generated five-digit pairing challenges with the dev API and poll challenge status from the PCVR UI.
- [x] Display claimed state in the PCVR UI when the account claims the code on the dev website.
- [x] Generate a 32-byte installation credential and protect it locally with Windows DPAPI CurrentUser.
- [x] Store only the credential SHA-256 digest in D1 and transfer it to the device record when the website claims pairing.
- [x] Add a Railway API WebSocket bearer credential validation branch restricted to active, non-revoked devices; deployed to the Railway development environment.
- [ ] Validate a successful device-authenticated WebSocket connection after an account claims a real PCVR pairing code (negative probe returned an HTTP 502 at the public WS endpoint, so end-to-end acceptance remains unconfirmed).
- [x] Add interactive local-only Chat and BSR module switch previews to the PCVR BSML screen.
- [x] Persist PCVR Chat/BSR module switch preview state locally under `%LOCALAPPDATA%\\RiftPulse\\pcvr-module-preview-settings.txt`; reload on view construction and save on each toggle. Clearly labeled as local saved preview (no service activation). Compile verified with `dotnet build -c Release --no-restore` (0 warnings, 0 errors; November 4, 2026).
- [x] Implement dedicated device-credential authenticated module settings GET/PATCH endpoints in the shared API source (credential digest lookup, active/non-revoked device + active account checks, JSON/body validation, module settings persistence); browser-session settings endpoints remain separate. Full project test pipeline passed (42 unit tests, isolated migration test, production build; November 4, 2026). Endpoint-specific device-auth tests still need to be added.
- [x] Wire PCVR module toggles to PATCH device settings and load account settings after pairing claim; PCVR Release build passed (0 warnings/errors; November 4, 2026). Local preview state remains as fallback when settings sync is unavailable.
- [ ] Deploy the updated API to Railway development and verify GET/PATCH with a real paired device credential; test invalid, revoked, and inactive-account rejection.
- [ ] Implement dashboard activation gating and configuration navigation; module settings currently save configuration flags only and do not activate Chat/BSR services.
- [ ] Port the same UI flow to Quest.
- [ ] Runtime-test both targets in actual Beat Saber installations/headsets.
- [x] Correct the Quest QMOD manifest encoding: remove the UTF-8 BOM and use the accepted QMOD schema version 1.2.0.
- [x] Align Quest release 0.1.8 across the QMOD manifest, template, QPM info.version fields, CMake VERSION definition and tester README, preserving the separate root QPM schema-version fields.
- [x] Rebuild the Quest ARM64 native library with CMake/Ninja for version 0.1.8 (build exit code 0; native ARM64 binary refreshed).
- [x] Package Quest 0.1.8 with a root mod.json and libriftpulse.so; explicitly select Scotland2 and declare the four QPM-resolved dependency QMODs; verify UTF-8 JSON, no BOM, dependency URLs, and referenced entries.
- [x] Run npm test: TypeScript check, 42 contract tests, isolated database migration test, and production build all passed.
- [x] Deploy Quest 0.1.8 and its README to the isolated Cloudflare development Worker; homepage, QMOD and README returned HTTP 200 and remote QMOD SHA-256 matched local bytes.
- [x] Alpha tester confirmed the published Quest 0.1.16 QMOD imports/loads normally on Quest and appears to behave as expected at the package-load level (November 4, 2026). Feature-level Quest pairing/API, persisted settings, chat, and BSR are still not implemented; PCVR runtime test remains pending.

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
