# RiftPulse TikTok LIVE bridge (unofficial)

This is a separate Node.js process because `tiktok-live-connector` uses Node HTTP/WebSocket APIs and should not be bundled into the Cloudflare Worker. It reads a public TikTok LIVE stream and forwards chat and supported stream events to RiftPulse's signed ingest endpoint. It does not send messages to TikTok and does not require TikTok login cookies.

## Status

The bridge source, pinned connector dependency, signed ingest API, event persistence, and realtime fan-out are implemented locally. A live test still requires a TikTok account that is currently live, local RiftPulse account ID, local Worker/D1 running with migrations applied, and the same bridge HMAC secret configured on both sides. Do not deploy production resources as part of this local test.

## Configure locally

Use Node.js 20 or newer. Configure the Worker in a local-only `.dev.vars` file with `TIKTOK_CONNECTOR_INGEST_SECRET` set to a random secret of at least 32 characters. Do not commit that file or copy the secret into the website frontend.

Set these environment variables for the bridge process:

- `RIFTPULSE_INGEST_URL` — `http://127.0.0.1:5173/api/v1/providers/tiktok/ingest` for local development, or the HTTPS development URL for a deployed dev environment.
- `RIFTPULSE_ACCOUNT_ID` — the ID of the RiftPulse account that owns this connection.
- `TIKTOK_USERNAME` — the public LIVE creator username, with or without `@`.
- `TIKTOK_CONNECTOR_INGEST_SECRET` — exactly the same secret as the Worker binding.

Install and type-check from the repository root:

```powershell
npm.cmd install --prefix services/tiktok-bridge
npm.cmd --prefix services/tiktok-bridge run typecheck
```

Then start the bridge in a terminal where those four environment variables are set:

```powershell
npm.cmd --prefix services/tiktok-bridge start
```

The bridge signs the exact JSON request body with HMAC-SHA256 and a Unix-seconds timestamp. The Worker rejects invalid signatures, timestamps more than five minutes old, oversized bodies, unknown accounts, and unsupported event payloads. Event/chat payload details are intentionally suppressed from bridge error logs. The bridge retries connection failures with bounded exponential backoff and reconnects after disconnects or stream-end events; keep the process running while you test, and stop it with Ctrl+C.

## Reliability and licensing

This integration is unofficial, reverse-engineered, and best-effort; TikTok can change its protocol or block the connector. It should report degraded/disconnected health rather than imply guaranteed delivery. The pinned `tiktok-live-connector` package declares `AGPL-3.0-only`; review the license obligations before redistributing or combining the bridge with a distributed product. Gift quantities/diamonds are not represented as cash donations.


### Railway runtime

The Railway development service runs the compiled bridge entry point with `node dist/index.js`. Keep it in test mode unless a TikTok LIVE connection has been explicitly approved.
