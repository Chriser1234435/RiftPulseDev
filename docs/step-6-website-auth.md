# Step 6 — Website and authentication

Status: **Complete for the local website/authentication foundation.** Remote sign-in and production deployment are intentionally disabled. No Cloudflare account resources or provider OAuth applications were configured.

## Website

- Responsive dark Beat Saber-inspired RiftPulse dashboard with mobile layouts.
- Module cards for Chat and BSR Song Request with accessible toggle states.
- Module toggles persist to the authenticated account in local D1.
- BSR command preference persists in the module settings JSON and validates the `!name` format.
- Integration UI for Twitch, YouTube, Kick, and TikTok LIVE. Provider buttons are clearly preview-only; they do not contact or authorize external accounts.
- Device panel lists active paired devices, shows game/mod versions, and supports revocation.
- Pairing dialog accepts a five-digit code shown by the in-game mod. The website never generates a pretend pairing code.
- Settings/help dialogs, API health indicator, reduced-motion support, and loading/error feedback.
- Build cleanup removes any copied `.dev.vars` files from both Worker and client build output.

## Authentication

- Better Auth is wired to local Cloudflare D1 through the Kysely D1 dialect.
- Email/password sign-up and sign-in, server sessions, sign-out, and account creation hooks are implemented.
- Password length is constrained to 8–128 characters; session lifetime is seven days.
- Session cookies are tested for `HttpOnly` and `SameSite=Lax`.
- New Better Auth users get an associated RiftPulse account profile used for device ownership and settings.
- Authentication only activates for a localhost base URL. Remote origins return an explicit not-configured response.
- Email verification is disabled for local development only. Do not enable remote auth until an email delivery provider, verified-origin allowlist, secure production cookie configuration, and production security review are implemented.

## API/persistence added

- `GET /api/v1/settings/modules` and `PATCH /api/v1/settings/modules/:moduleKey` read and save per-account module settings.
- `GET /api/v1/devices` lists active devices owned by the authenticated account.
- `DELETE /api/v1/devices/:id` revokes an owned device and marks its claimed pairing challenge revoked.
- `POST /api/v1/pairing/claim` now requires a verified Better Auth session.
- Cookie-authenticated mutations check the exact configured `Origin`; missing/untrusted origins are rejected.
- D1 migration `0002_auth.sql` adds the Better Auth core tables. The migration is local-only.

## Validation

- `npm test` passed: TypeScript type-check, 15 unit tests, isolated SQLite schema/constraint test, and combined Worker/client production build.
- `npm run test:auth:local` passed: sign-up/session creation, cookie flags, CSRF origin checks, module settings persistence, unauthenticated claim rejection, authenticated one-time claim, device listing/revocation, and sign-out.
- Local D1 migration listing reports no pending migrations.
- Verified the generated Worker/client build directories contain no `.dev.vars` copies.
- Local `.dev.vars` holds two distinct random development secrets and is ignored by Git. Secret values are not documented or committed.

## Remaining gates before production

1. Select and implement email verification delivery; verify reset/verification flows.
2. Configure the real development hostname and exact trusted origins.
3. Review Better Auth rate-limit IP handling behind Cloudflare and set trusted proxy/IP headers appropriately.
4. Implement real provider OAuth/token encryption and provider health; keep TikTok explicitly unofficial/best-effort.
5. Add production security review and explicit authorization before any Cloudflare deployment.
6. Implement the full chat, command execution, and BSR queue features in later steps.

Local development: copy `.dev.vars.example` to `.dev.vars`, generate separate random values for `PAIRING_HMAC_KEY` and `BETTER_AUTH_SECRET`, then run `npm run dev`. Do not reuse passwords or keys from other services.
