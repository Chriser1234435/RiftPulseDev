# RiftPulse Preview Password Recovery

Password recovery uses Better Auth's email/password reset tokens and Resend for delivery. The auth API is hosted on Railway and sends through Resend's REST API.

## Required Railway development variables

Set these only on the `riftpulse-api` service in the Railway `development` environment:

- `RESEND_API_KEY`: Resend API key. Treat as a secret; never commit or paste into chat.
- `RESEND_FROM_EMAIL`: sender identity verified in Resend, for example `RiftPulse <no-reply@riftpulse.me>`. 

The reset token expires after 60 minutes, is single use, and Better Auth revokes active sessions after a successful password reset. The app uses an enumeration-resistant success response. Mail delivery is not active until the above values are configured.

## Resend setup

1. In Resend, confirm the `riftpulse.me` domain is verified and that the sender mailbox is authorized.
2. Create an API key with sending permissions. Copy it once and store it securely.
3. Railway dashboard → RiftPulseDev project → development environment → `riftpulse-api` service → Variables. Confirm `RESEND_API_KEY` is set, add `RESEND_FROM_EMAIL` with the verified sender identity, and allow the service to redeploy.
4. Send a reset request from the preview login page and check the destination inbox (including spam). Verify the link opens the preview app and the password change succeeds.

Do not configure these variables on production until production auth has separately been reviewed.
