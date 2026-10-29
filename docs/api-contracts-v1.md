# RiftPulse API contracts — V1

Status: Step 5 implementation draft. All endpoints are versioned under `/api/v1`.

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

Accepts `{ "code": "04271" }`. It currently returns 401 until Step 6 connects the website's verified authentication session. The account ID must be derived from that verified session and must never be trusted from request JSON. The shared persistence helper performs a one-time pending-to-claimed transition and inserts the device in a D1 batch; the raw code digest is cleared on claim. Claim integration tests require an authenticated test context and are deferred to the auth integration step.

### `GET /api/v1/pairing/status`

Requires a verified website session; currently returns 401 until the Step 6 authentication adapter exists.

## Database entities

- `accounts`: stable internal account ID and lifecycle status; no auth vendor-specific columns.
- `devices`: platform, game/mod versions, ownership, last-seen, and revocation.
- `pairing_challenges`: HMAC digest, expiry, state, attempt counter, and claim metadata.
- `provider_connections`: one record per account/provider; token fields are ciphertext-only placeholders for a later encryption design.
- `module_settings`: persisted enabled flag and JSON configuration for each V1 module.
- `chat_commands`: configurable commands, actions, cooldowns, and JSON configuration.
- `song_requests`: normalized request input, BeatSaver key/metadata, requester, provider, and queue state.
- `integration_health`: per-provider status and last observed viewer count; null means unknown, not zero.
- `idempotency_keys`: operation-scoped idempotency responses with expiry.

## Security notes and open gates

- Five-digit codes have low entropy. HMAC is required rather than an ordinary unsalted hash, but it does not replace rate limiting. Production must add edge-level rate limits, per-account/IP attempt limits, and monitoring before public deployment.
- Pairing challenges must only be claimed by an authenticated account, must be single-use, and must expire.
- OAuth token encryption/key management and provider OAuth scopes are not implemented by this schema alone.
- No remote D1 database, production binding, secret, or deployment is created in Step 5.
