# RiftPulseDev - Proposed Roadmap

Status: Step 6 complete for the local website/authentication foundation. Step 7 has not started and requires explicit authorization.

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
- [x] Add a one-time claim helper and keep the public claim route gated until verified website authentication exists.
- [x] Validate TypeScript, unit tests, isolated schema constraints, local migration, and Worker build.

## Step 6 - Website and authentication
- [x] Build the responsive RiftPulse dashboard, module cards, integration UI, settings/help dialogs, and pairing form.
- [x] Add local-only Better Auth sign-up/sign-in/session/sign-out backed by D1.
- [x] Add authenticated per-account module settings persistence and BSR command preference storage.
- [x] Add authenticated device listing, claim, and revocation.
- [x] Add trusted-Origin checks for cookie-authenticated mutation routes.
- [x] Verify cookie flags, local auth/device/settings smoke tests, migration schema, TypeScript, and Worker/client build.
- [x] Keep remote auth and Cloudflare deployment disabled until email delivery and production security configuration are approved.

## Step 7 - Chat and providers (not started; requires authorization)
Implement normalized events, deduplication, reconnect handling, provider health, viewer aggregation, and chat display. Validate each provider's current OAuth/API requirements. Prove TikTok runtime feasibility in isolation.

## Step 8 - BSR Song Request
Implement command parsing, BeatSaver metadata validation, cooldowns, queue rules, and explicit error states.

## Step 9 - PCVR and Quest integration
Build the in-game pairing flow and UI for each target; test them separately on actual devices.

## Step 10 - End-to-end validation and deployment
Run security, API, provider-mock, PCVR, and Quest tests. Deploy only to isolated Cloudflare development resources and a development hostname after explicit authorization. Test the actual development domain, not only previews.

## V1 acceptance criteria
- Pairing uses a mod-generated five-digit code with short expiry and single use.
- PCVR and Quest can connect and show clear status.
- All four provider connectors report honest health; TikTok is clearly marked unofficial/best-effort.
- Chat messages normalize and display correctly; viewer total indicates partial data when needed.
- Configured chat commands can enqueue valid BSR requests with cooldowns and explicit failures.
- Settings persist and device/provider disconnection works.
- No Clerk, no legacy code import, no secrets committed, and no email/DNS disruption.
