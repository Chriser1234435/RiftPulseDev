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

Architecture approved. Step 4 established a clean local repository foundation and identified outstanding toolchain validation. No production cloud resources have been changed.

## Security and contribution rules

- Never commit credentials, tokens, OAuth secrets, device pairing codes, or local environment files.
- Keep development and production resources separate.
- Do not import old RiftPulse source code, migrations, or deployment configuration into this clean-room project.
- Keep platform-specific game code behind explicit adapters and shared versioned contracts.
