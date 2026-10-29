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
- `mods/quest` — standalone Quest-specific adapter; not assumed to share the PCVR binary or toolchain.
- `tests` — unit and integration tests.
- `docs` — approved architecture, roadmap, and toolchain audit.

## Current status

Steps 3–6 have a documented architecture, local API/persistence foundation, and local website/authentication implementation. The current website and API run locally through Vite + the Cloudflare Worker runtime. Provider OAuth, email verification delivery, full chat/BSR execution, actual mod runtime integration, and deployment are still outstanding. No production Cloudflare resources have been changed.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars`.
3. Generate two **different** random secrets for `PAIRING_HMAC_KEY` and `BETTER_AUTH_SECRET`; never use a password or key from another service.
4. Keep `APP_BASE_URL=http://127.0.0.1:5173` and `TRUSTED_ORIGINS=http://127.0.0.1:5173` for the local setup.
5. Apply migrations to local D1 only: `npm run db:migrate:local`.
6. Start the website/API: `npm run dev`, then open `http://127.0.0.1:5173`.
7. Run the full type/unit/schema/build checks with `npm test`.
8. With the dev server running, `npm run test:auth:local` exercises sign-up, sessions, settings, device pairing/revocation, and sign-out against local D1.

Local email/password auth is deliberately restricted to localhost. Do not use the local-only auth configuration as production authentication. Do not run Wrangler with `--remote` or deploy unless separately authorized.

## Security and contribution rules

- Never commit credentials, tokens, OAuth secrets, device pairing codes, or local environment files.
- Keep development and production resources separate.
- Do not import old RiftPulse source code, migrations, or deployment configuration into this clean-room project.
- Keep platform-specific game code behind explicit adapters and shared versioned contracts.
