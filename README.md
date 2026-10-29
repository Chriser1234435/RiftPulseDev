# RiftPulseDev

A clean-room RiftPulse project for Beat Saber PCVR and standalone Quest.

## V1 scope

- **Chat** — normalized multi-platform livestream chat, an in-game chat panel and viewer count, and configurable viewer commands.
- **BSR Song Request** — validated song requests and a controlled queue.

## Architecture

- `apps/web` — RiftPulse website UI.
- `apps/api` — Cloudflare Worker API and live-session endpoints.
- `packages/contracts` — versioned API and event contracts shared across components.
- `packages/shared` — platform-neutral logic.
- `mods/pcvr` — PCVR-specific Beat Saber adapter.
- `mods/quest` — standalone Quest-specific Beat Saber adapter.
- `services/tiktok-bridge` — separate Node.js bridge for unofficial TikTok LIVE chat/events.
- `tests` — unit and integration tests.
- `docs` — approved architecture, roadmap, and toolchain audit.

## Current status

- The isolated development preview is deployed at https://riftpulse-dev.chrismeten0.workers.dev.
- The separate Cloudflare D1 database `riftpulse-dev-db` has migrations `0001` through `0007` applied.
- The Worker health endpoint is responding successfully. No production DNS or production database has been changed.
- Remote preview authentication is gated by `ALLOW_REMOTE_DEV_AUTH=true`, HTTPS on a `workers.dev` hostname, a single exact trusted origin, and a valid `BETTER_AUTH_SECRET`. Development accounts are temporary and do not use email verification.
- The remote Worker currently has no Wrangler secrets configured. Authentication, device pairing, encrypted provider-token storage, and TikTok bridge ingestion therefore remain disabled until their secrets are securely added.
- The TikTok bridge is separate from Cloudflare Worker runtime and has not been started. A real LIVE test still requires a valid public LIVE username and a shared ingest secret configured on both sides.
- Full chat/BSR execution and actual mod runtime integration remain in progress.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars`.
3. Generate different random secrets for `PAIRING_HMAC_KEY` and `BETTER_AUTH_SECRET`; generate a separate Base64-encoded 32-byte key for `TOKEN_ENCRYPTION_KEY`, and a separate random secret for `TIKTOK_CONNECTOR_INGEST_SECRET`.
4. Keep `APP_BASE_URL=http://127.0.0.1:5173` and `TRUSTED_ORIGINS=http://127.0.0.1:5173` for local development.
5. Apply migrations to local D1 only: `npm run db:migrate:local`.
6. Start the website/API with `npm run dev`, then open `http://127.0.0.1:5173`.
7. Run the full type/unit/schema/build checks with `npm test`.
8. With the local dev server running, `npm run test:auth:local` exercises sign-up, sessions, settings, device pairing/revocation, and sign-out against local D1.

## Development deployment boundaries

The user explicitly authorized the isolated `riftpulse-dev` Worker and `riftpulse-dev-db` database. This authorization does not cover production DNS, production databases, or unrelated Cloudflare resources. Do not use the local-only auth configuration as production authentication. Production auth requires email-verification delivery and a separate security review.

## Security and contribution rules

- Never commit credentials, tokens, OAuth secrets, device pairing codes, or local environment files.
- Keep development and production resources separate.
- Do not import old RiftPulse source code, migrations, or deployment configuration into this clean-room project.
- Keep platform-specific game code behind explicit adapters and shared versioned contracts.
