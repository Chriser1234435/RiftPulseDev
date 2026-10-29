# RiftPulse TikTok LIVE bridge (unofficial)

This is a separate Node.js process because `tiktok-live-connector` uses Node HTTP/WebSocket APIs and should not be bundled into the Cloudflare Worker. It reads public TikTok LIVE streams and forwards supported chat and stream events to RiftPulse's signed ingest endpoint. It does not send messages to TikTok and does not require TikTok login cookies.

## Multi-account configuration

The bridge discovers configured TikTok usernames through the private API endpoint `/api/v1/internal/tiktok/accounts`. That endpoint requires the same high-entropy `TIKTOK_CONNECTOR_INGEST_SECRET` as signed ingest. It returns only RiftPulse account IDs and saved public TikTok usernames; never expose this secret to browser code.

Set these environment variables for the bridge service:

- `RIFTPULSE_INGEST_URL` — HTTPS URL ending in `/api/v1/providers/tiktok/ingest`.
- `TIKTOK_CONNECTOR_INGEST_SECRET` — at least 32 characters, identical to the API's secret.
- `TIKTOK_MAX_ACTIVE_ACCOUNTS` — optional per-process cap, defaults to 10 and is limited to 50.
- `TIKTOK_ACCOUNT_POLL_MS` — optional discovery interval, defaults to 30 seconds (minimum 15 seconds).

Each RiftPulse user saves their own public TikTok username in provider settings. The bridge maintains a separate connection, reconnect loop, and event queue for each configured RiftPulse account. Removing or changing a username stops the prior connection on the next sync. The API checks the signed event's account ID against that account's saved username before accepting it.

For local development, set `TIKTOK_CONNECTOR_INGEST_SECRET` in a local-only `.dev.vars` file and the bridge process environment. Do not commit secrets or place them in the website frontend. Build with:

```powershell
npm.cmd install --prefix services/tiktok-bridge
npm.cmd --prefix services/tiktok-bridge run build
```

The Railway development bridge should remain paused unless an explicitly approved LIVE test is in progress. A username saved in RiftPulse is a configuration choice, not proof of ownership; only configure a TikTok account you control or have permission to monitor.

## Reliability and licensing

This integration is unofficial, reverse-engineered, and best-effort; TikTok can change its protocol or block the connector. It should report degraded/disconnected health rather than imply guaranteed delivery. Gift quantities/diamonds are not represented as cash donations. The pinned `tiktok-live-connector` package declares `AGPL-3.0-only`; review the license obligations before redistributing or combining the bridge with a distributed product.

### Railway runtime

The Railway development service must stay paused unless an explicitly approved LIVE test is underway. The bridge discovers accounts automatically when running; do not restore the live start command just to test account discovery.

The bridge reports each account's connected, disconnected, or error state through a second secret-protected internal endpoint. The API stores connection status and per-account integration health independently; disconnecting or changing a saved username stops the prior connection and marks it disconnected.
