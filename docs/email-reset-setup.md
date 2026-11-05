# RiftPulse Password Recovery

Password recovery uses Better Auth's email/password reset tokens and Resend for delivery. The auth API is hosted on Railway and sends through Resend's REST API.

## Required Railway variables

Set these on the live `riftpulse-api` service in Railway:

- `RESEND_API_KEY`: Resend API key. Treat as a secret; never commit or paste into chat.
- `RESEND_FROM_EMAIL`: sender identity verified in Resend, for example `RiftPulse <no-reply@riftpulse.me>`. 

The reset token expires after 60 minutes, is single use, and Better Auth revokes active sessions after a successful password reset. The app uses an enumeration-resistant success response. The live API now passes the configured Resend key and sender identity to the delivery function.

## Resend setup

1. In Resend, confirm the `riftpulse.me` domain is verified and that the sender mailbox is authorized.
2. Create an API key with sending permissions. Copy it once and store it securely.
3. Railway dashboard → RiftPulseDev project → `riftpulse-api` service → Variables. Confirm `RESEND_API_KEY` is set and `RESEND_FROM_EMAIL` is `RiftPulse <no-reply@riftpulse.me>`. The application passes both values to the Resend sender.
4. Send a reset request from https://app.riftpulse.me and check the destination inbox (including spam). Verify the link opens the production app and the password change succeeds.

The Resend API key remains a Railway secret; never paste it into chat or commit it to source.
