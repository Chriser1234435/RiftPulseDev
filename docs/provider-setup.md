# Twitch and YouTube provider setup

This guide covers the website/API chat and event pipeline. In-game Beat Saber rendering and BSR request fulfillment are separate mod-integration work.

## YouTube

### OAuth scope

RiftPulse requests one read-only scope:

- `https://www.googleapis.com/auth/youtube.readonly`

This scope is used to identify the authorized channel, discover its active broadcast/live-chat ID, and read live-chat messages and supported live-chat event resources. The current normalizer handles Super Chats, Super Stickers, new memberships/member milestones, and membership-gifting events. YouTube does not expose Twitch-style follower events through this live-chat flow.

### Google Cloud setup

1. Open the Google Cloud project used for RiftPulse.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen. While the OAuth app is in Testing, add the Google account that will authorize the channel as a test user.
4. Create an OAuth client ID of type **Web application**.
5. Add this exact Authorized redirect URI (no trailing slash):
   `https://app.riftpulse.me`
6. Set the OAuth client ID and client secret on the Railway `riftpulse-api` service as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Set `YOUTUBE_REDIRECT_URI` to the exact same value, `https://app.riftpulse.me`.

### Connect and receive

1. Open **app.riftpulse.me → Integrations → YouTube → Connect**.
2. Sign in with the Google account that owns or manages the live channel and grant the read-only permission.
3. Start or schedule a YouTube livestream with live chat enabled.
4. Keep RiftPulse's **Chat** module enabled and the dashboard open. The dashboard now polls YouTube at the `pollingIntervalMillis` returned by the API, with a bounded 5–60 second interval, and pauses/retries more slowly while the page is hidden.
5. Verify incoming messages and supported live-chat events in **Chat & Events**.

The Google authorization flow requests offline access so the API can refresh access tokens. If Google does not issue a refresh token, reconnect the provider and approve the requested permission again.

## Twitch

### OAuth scopes requested by RiftPulse

RiftPulse requests these six scopes:

- `user:read:chat` — read chat messages for the authorized chat identity.
- `user:bot` — authorize that identity to act as the chat bot for EventSub.
- `channel:bot` — authorize the broadcaster channel for the chat EventSub subscription.
- `moderator:read:followers` — receive follower events.
- `channel:read:subscriptions` — receive subscription, resubscription-message, and gifted-subscription events.
- `bits:read` — receive Bits/cheer events.

The current OAuth connection uses the connected Twitch identity for both the broadcaster and chat-bot identity. The API creates webhook EventSub subscriptions using an App Access Token after the required user scopes have been granted to this Twitch Client ID.

RiftPulse currently receives chat and events; it does not request `user:write:chat` because sending bot messages back into Twitch chat is not part of this receive-only setup.

### Twitch Developer Console

1. Open the Twitch Developer Console and select the application whose Client ID/Secret are configured for RiftPulse.
2. Add this exact OAuth Redirect URL (no trailing slash):
   `https://app.riftpulse.me`
3. Confirm the Client ID and Client Secret match the same Twitch application.
4. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI` on the Railway `riftpulse-api` service. `TWITCH_REDIRECT_URI` must be exactly `https://app.riftpulse.me`.
5. The Railway API also needs `TWITCH_EVENTSUB_SECRET`, a private 10–100 character ASCII secret used to verify signed Twitch webhook requests. It is managed as an API environment variable; it is not entered in the Twitch Developer Console or exposed to the browser.

### Connect and enable event delivery

1. Open **app.riftpulse.me → Integrations → Twitch → Connect**.
2. Authorize all six requested permissions.
3. Return to RiftPulse and open **Manage** on the Twitch row.
4. Select **Enable chat events**. This asks Twitch to create or reconcile the webhook EventSub subscriptions.
5. Keep the **Chat** module enabled and check **Chat & Events**. A new webhook subscription can remain in verification-pending state until Twitch completes its callback challenge.

The webhook callback is:

`https://app.riftpulse.me/api/v1/providers/twitch/webhook`

The current subscription set is:

- `channel.chat.message`
- `channel.follow`
- `channel.subscribe`
- `channel.subscription.gift`
- `channel.subscription.message`
- `channel.cheer`

Twitch webhooks require an App Access Token for subscription creation. The broadcaster must first authorize the app for the scopes required by the selected event types.

## TikTok LIVE bridge

TikTok remains an unofficial, best-effort integration. The bridge listens for chat, follow, gift, like, share, member, new-subscription, and room-viewer callbacks. Event payloads are normalized, signed, sent to the API, persisted idempotently, and published to the dashboard's realtime feed. Test against a real LIVE session before treating delivery as verified.

## Troubleshooting checklist

- Verify each provider's Client ID and Client Secret came from the same app registration.
- Check the OAuth redirect URI is an exact string match with the configured value.
- After connecting Twitch, explicitly run **Enable chat events**.
- For Twitch webhook subscription errors, check the Railway API deployment logs for the sanitized failure stage/status and confirm the webhook signing secret is configured.
- For YouTube, check that the channel is actually live and live chat is enabled; no active live-chat ID means there are no chat resources to poll.
- For TikTok, check that the bridge service is running, the account username is configured, the stream is live, and the bridge/API ingest secrets match without exposing either secret in logs.
