# Step 6 — Website and authentication

Status: **local website/auth foundation complete**. Real provider integrations are Step 7. Remote authentication and deployment are not enabled.

## Website
- Responsive, dark Beat Saber-inspired RiftPulse dashboard and account screen.
- Module cards for Chat and BSR Song Request with accessible toggles.
- Account-specific module settings and BSR command persistence.
- Provider cards for Twitch, YouTube, Kick, and TikTok LIVE.
- Device pairing dialog, paired-device list, and device revocation.
- Settings/help dialogs, API health indicator, and reduced-motion styling.
- Provider cards are preview-only until real OAuth adapters are implemented; TikTok is labelled unofficial/best-effort.
- Pairing codes are entered from the game; the website does not generate a code.
- The sign-in/entry screen was visually checked in headless Chrome at desktop and narrow-layout sizes; the mobile breakpoint was adjusted after review.

## Authentication and persistence
- Better Auth email/password sign-up, sign-in, session lookup, and sign-out are wired to the local Worker.
- Local D1 auth migration is present alongside application tables.
- Protected API routes cover module settings and device management.
- Cookie-authenticated mutations require an exact trusted Origin.
- A local integration smoke test verifies session cookie flags, account/session behavior, origin protection, module setting persistence, one-time pairing claim, device listing/revocation, and sign-out. The script cleans up its local test account.
- npm test passes: strict TypeScript check, unit tests, isolated SQLite schema test, and Vite/Cloudflare Worker + client builds.
- The build script removes .dev.vars copies from generated output. The ignored local .dev.vars file contains development-only keys and must never be committed.
- npm audit --omit=dev reported zero vulnerabilities.

## Explicitly not enabled
- Remote/production auth, email verification, password-reset delivery, and production cookie/origin configuration.
- Real OAuth for Twitch, YouTube, or Kick; TikTok connector runtime feasibility.
- Any Cloudflare production resource, DNS, provider registration, or deployment.

## Safety boundaries
All work and auth tests were local. No Cloudflare account resources, remote D1 database, DNS, provider registrations, or deployments were changed. Do not deploy until the user explicitly authorizes a later deployment step.
