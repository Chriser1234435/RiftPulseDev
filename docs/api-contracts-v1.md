# RiftPulse API contracts — V1

Status: Local Step 5–7 implementation. Real provider transports and remote deployment remain gated. All endpoints are versioned under `/api/v1`.

## Scope

V1 has only two modules: `chat` and `bsr-song-request`. Supported integration keys are `twitch`, `youtube`, `kick`, and `tiktok`. TikTok must be marked unofficial/best-effort in provider status and UI. PCVR and Quest remain distinct device platforms.

## Standard response behavior

- JSON responses use `application/json; charset=utf-8` and `Cache-Control: no-store`.
- Error shape: `{ "error": { "code": "STABLE_CODE", "message": "Human-readable message" } }`. Validation errors may include an `issues` array of `{path, message}`.
- Unknown API paths return 404; unknown API versions must not silently route to a different version.
- Never log pairing codes, OAuth tokens, authorization headers, or secret values.

## Endpoints in this step

### `GET /api/v1/health`

Returns service health and API/service version. This endpoint does not claim provider connectivity or database readiness.

### `GET /api/v1/version`

Returns API version and the supported V1 module keys.

### `POST /api/v1/pairing/challenges`

The mod generates a random five-digit code locally and sends it to the API over HTTPS. Request body:

```json
{
  "code": "04271",
  "deviceId": "2cceae24-4d3b-4faa-b243-5299f702f02e",
  "platform": "quest",
  "gameVersion": "1.40.8_7379",
  "modVersion": "0.1.0"
}
```

The server returns only a challenge ID, pending status, expiry, and suggested poll interval. It stores an HMAC-SHA-256 digest, not the raw code. Challenges expire after five minutes; expired reservations are released; the same active code cannot be reserved twice; a device may have at most three active challenges. The HMAC key must be supplied through a local-only `.dev.vars` file or a secret manager and must never be committed.

Statuses: 201 created; 400 invalid request; 409 active code collision; 429 active challenge limit; 503 missing configuration or storage failure.

### `POST /api/v1/pairing/claim`

Accepts `{ "code": "04271" }`. A valid Better Auth session and an exact trusted `Origin` are required. The account ID is derived from the verified session, never request JSON. The shared persistence helper performs a one-time pending-to-claimed transition and inserts the device in a D1 batch; the raw code digest is cleared on claim. Local integration tests cover authenticated claim, listing, revocation, and sign-out.

### `GET /api/v1/pairing/challenges/:id`

The mod polls this endpoint using the unguessable challenge UUID returned at creation. It returns only the challenge ID, status, expiry, and optional claim timestamp; it never returns the code or its digest. Unknown IDs return 404. The website claim endpoint requires the verified account session and trusted Origin described above.

## Chat and provider endpoints (local foundation)

### `GET /api/v1/chat/messages`

Requires an authenticated account session. Returns up to 100 recent normalized messages for that account, oldest-to-newest within the returned window. Raw provider payloads are not returned.

### `GET /api/v1/integrations/health`

Requires an authenticated account session. Returns health snapshots for the four provider keys and a viewer aggregate. Only fresh counts from connected/degraded providers contribute. `total: null` means unknown, not zero; `partial: true` means at least one count is fresh while other providers are missing or stale. The API is a read model; provider ingestion and viewer-count updates are still being implemented.

### `POST /api/v1/providers/twitch/webhook`

Public Twitch EventSub callback. Requires the local-only `TWITCH_EVENTSUB_SECRET` (10–100 characters) and verifies the HMAC-SHA256 signature over message ID + timestamp + exact raw body before processing. Rejects stale messages, caps bodies at 64 KiB, returns the signed challenge for callback verification, handles channel-chat notifications, and marks mapped connections degraded on signed revocation events. OAuth and subscription creation are not implemented yet.

### `POST /api/v1/providers/kick/webhook`

Public provider callback; it does not use a browser account session. It requires Kick message ID, timestamp, signature, event type, and version headers. The receiver fetches and briefly caches Kick's current public key, verifies the RSA-SHA256 signature over `messageId.timestamp.rawBody`, rejects stale timestamps, caps the body at 64 KiB, accepts version 1 `chat.message.sent` events, and routes only to connected channel mappings. Stored messages are idempotent by account/provider/message ID. Unsupported events and unmapped channels receive a successful ignored response. OAuth and subscription setup remain unfinished.

Implementation references: [Kick webhook security](https://github.com/KickEngineering/KickDevDocs/blob/main/events/webhook-security.md) and [Twitch EventSub verification](https://dev.twitch.tv/docs/eventsub/handling-webhook-events/).

### `GET /api/v1/realtime`

Requires an authenticated session, a trusted browser `Origin`, and a WebSocket upgrade. The Worker selects a per-account Durable Object, which sends new normalized `chat.message` events to connected clients. Realtime delivery is best-effort; clients can recover missed messages through `GET /api/v1/chat/messages`.

## Provider connection endpoints

### `GET /api/v1/providers/connections`

Requires an authenticated session. Returns safe provider connection status, display name, connection timestamp, configuration availability, and a non-secret status code. It never returns OAuth tokens or client secrets.

### `POST /api/v1/providers/twitch/connect`

Requires an authenticated session and trusted `Origin`. Creates a high-entropy, ten-minute, single-use OAuth state whose digest is stored in D1, sets a short-lived HttpOnly/SameSite state cookie, and returns the official Twitch authorization URL. It fails closed unless Twitch client credentials, the canonical app URL, and the token-encryption key are configured. The callback URI must be same-origin and registered exactly with Twitch.

### `GET /api/v1/providers/twitch/callback`

Consumes state once and requires a matching same-browser cookie. Exchanges the authorization code, validates the resulting token with Twitch, requires `user:read:chat`, `user:bot`, and `channel:bot` for the webhook-based chat flow, and stores access/refresh tokens using AES-256-GCM encryption. It redirects to the local dashboard with a non-sensitive status. Token refresh and subscription recovery remain unfinished.

### `POST /api/v1/providers/twitch/eventsub/subscribe`

Requires an authenticated session and trusted `Origin`. Requires configured Twitch app credentials, an EventSub webhook secret, and a public HTTPS app URL. Validates the saved user token and required chat scopes, obtains an app access token for the webhook subscription API, checks for an existing matching subscription, and creates `channel.chat.message` version 1 if needed. It reports verification pending until Twitch sends the signed callback challenge; it does not mark the provider healthy merely because a create request succeeded.

### `DELETE /api/v1/providers/{provider}`

Requires an authenticated session and trusted `Origin`. Clears locally stored token ciphertext and marks health disconnected. TikTok disconnection is rejected because that connector is unavailable in this build.

## Database entities

- `accounts`: stable internal account ID and lifecycle status; no auth vendor-specific columns.
- `devices`: platform, game/mod versions, ownership, last-seen, and revocation.
- `pairing_challenges`: HMAC digest, expiry, state, attempt counter, and claim metadata.
- `provider_connections`: one record per account/provider; access and refresh tokens are stored only as AES-256-GCM ciphertext.
- `module_settings`: persisted enabled flag and JSON configuration for each V1 module.
- `chat_commands`: configurable commands, actions, cooldowns, and JSON configuration.
- `song_requests`: normalized request input, BeatSaver key/metadata, requester, provider, and queue state.
- `integration_health`: per-provider status and last observed viewer count; null means unknown, not zero.
- `idempotency_keys`: operation-scoped idempotency responses with expiry.

## Security notes and open gates

- Five-digit codes have low entropy. HMAC is required rather than an ordinary unsalted hash, but it does not replace rate limiting. Production must add edge-level rate limits, per-account/IP attempt limits, and monitoring before public deployment.
- Pairing challenges must only be claimed by an authenticated account, must be single-use, and must expire.
- A local AES-256-GCM provider-token vault helper is unit-tested, but OAuth token persistence, refresh flows, key rotation, and provider scopes are not yet wired.
- No remote D1 database, production binding, secret, or deployment is created in Step 5.
