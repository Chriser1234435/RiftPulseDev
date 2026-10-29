# RiftPulseDev — Proposed Roadmap

Status: planning only. Each step is reported before proceeding; no step is authorized automatically.

## Step 3 — Architecture and design
- [x] Define V1 scope: Chat + BSR Song Request only.
- [x] Define Cloudflare-first website/API, D1 persistence, and Durable Object realtime coordination.
- [x] Define no-Clerk auth direction and compatibility validation gate.
- [x] Define separate PCVR/Quest adapters and versioned API contracts.
- [x] Define mod-generated five-digit, short-lived, one-time pairing.
- [x] Define Twitch, YouTube, Kick, and isolated unofficial TikTok connector behavior.
- [x] Define security, UI, reliability, and test requirements.
- [ ] User approves or revises architecture.

## Step 4 — Toolchain and clean repository foundation (after architecture approval)
- Clone the empty RiftPulseDev repository into the new workspace.
- Verify Git, Node, Cloudflare toolchain, and CI gates.
- Verify PCVR loader, framework, and UI dependencies for Beat Saber 1.40.8.
- Verify Quest loader and Android SDK/ADB requirements.
- Prove Better Auth + D1 compatibility before selecting final auth dependencies.
- Do not deploy or create production resources.

## Step 5 — API contracts and persistence
Lock shared schemas, migrations, health/version endpoints, device authorization, and pairing expiry/replay protections.

## Step 6 — Website and authentication
Build the animated dashboard, module cards, secure auth, device management, provider connection UI, and settings.

## Step 7 — Chat and providers
Implement normalized events, deduplication, reconnect handling, provider health, viewer aggregation, and chat display. Validate each provider's current OAuth/API requirements. Prove TikTok runtime feasibility in isolation.

## Step 8 — BSR Song Request
Implement command parsing, BeatSaver metadata validation, cooldowns, queue rules, and explicit error states.

## Step 9 — PCVR and Quest integration
Build the pairing flow and in-game UI for each target; test them separately on actual devices.

## Step 10 — End-to-end validation and deployment
Run security, API, provider-mock, PCVR, and Quest tests. Deploy only to isolated Cloudflare development resources and a development hostname after explicit authorization. Test the actual development domain, not only previews.

## V1 acceptance criteria
- Pairing uses a mod-generated five-digit code with short expiry and single use.
- PCVR and Quest can connect and show clear status.
- All four provider connectors report honest health; TikTok is clearly marked unofficial/best-effort.
- Chat messages normalize and display correctly; viewer total indicates partial data when needed.
- Configured chat commands can enqueue valid BSR requests with cooldowns and explicit failures.
- Settings persist and device/provider disconnection works.
- No Clerk, no legacy code import, no secrets committed, and no email/DNS disruption.
