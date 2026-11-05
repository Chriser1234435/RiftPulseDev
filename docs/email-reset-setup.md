# RiftPulse Preview Password Recovery

Password recovery uses Better Auth's email/password reset tokens and Cloudflare Email Service sending. The auth API is hosted on Railway, so Cloudflare Email Service is accessed via its REST API from the Railway API service.

## Required Railway development variables

Set these only on the `riftpulse-api` service in the Railway `development` environment:

- `CF_EMAIL_ACCOUNT_ID`: Cloudflare account ID that owns the onboarded sender domain.
- `CF_EMAIL_API_TOKEN`: Cloudflare API token with Email Sending: Edit permission. Treat as a secret; do not commit or paste into chat.
- `CF_EMAIL_FROM`: sender mailbox on the onboarded domain, e.g. `no-reply@<your-domain>`.

The reset token expires after 60 minutes, is single use, and Better Auth revokes active sessions after a successful password reset. The app uses an enumeration-resistant success response. Mail delivery is not active until the above values are configured.

## Cloudflare Email Service setup

1. Cloudflare dashboard → Compute & AI → Email Service → Email Sending.
2. Choose Onboard Domain. Pick a domain already using Cloudflare DNS and finish the SPF/DKIM/DMARC/bounce records onboarding.
3. After domain verification, choose a sender address on that domain (for example, `no-reply@<your-domain>`).
4. Cloudflare dashboard → My Profile → API Tokens → Create Token. Create a scoped token with Email Sending: Edit for the account. Copy it once and store it securely.
5. Railway dashboard → RiftPulseDev project → development environment → `riftpulse-api` service → Variables. Add the three variables above and allow the service to redeploy.
6. Send a reset request from the preview login page and check the destination inbox (including spam). Verify the link opens the preview app and the password change succeeds.

Email Sending is currently Beta and may require a Workers Paid plan for arbitrary recipients. Cloudflare's dashboard and account plan determine eligibility. Do not configure these variables on production until production auth has separately been reviewed.
