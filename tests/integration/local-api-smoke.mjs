import assert from "node:assert/strict";

const baseUrl = process.env.RIFTPULSE_BASE_URL ?? "http://127.0.0.1:5173";

const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.service, "riftpulse-api");
assert.equal(health.apiVersion, "v1");

const versionResponse = await fetch(`${baseUrl}/api/v1/version`);
assert.equal(versionResponse.status, 200);
const version = await versionResponse.json();
assert.deepEqual(version.modules, ["chat", "bsr-song-request"]);

const challengeResponse = await fetch(`${baseUrl}/api/v1/pairing/challenges`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    code: "04271",
    deviceId: "550e8400-e29b-41d4-a716-446655440000",
    platform: "quest",
    gameVersion: "1.40.8_7379",
    modVersion: "0.1.0-dev",
  }),
});
assert.equal(challengeResponse.status, 201, await challengeResponse.clone().text());
const challenge = await challengeResponse.json();
assert.equal(challenge.status, "pending");
assert.equal(typeof challenge.challengeId, "string");
assert.equal("code" in challenge, false);

const statusResponse = await fetch(`${baseUrl}/api/v1/pairing/challenges/${challenge.challengeId}`);
assert.equal(statusResponse.status, 200);
const status = await statusResponse.json();
assert.equal(status.status, "pending");
assert.equal("code" in status, false);

const invalidResponse = await fetch(`${baseUrl}/api/v1/pairing/challenges`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    code: "12x45",
    deviceId: "550e8400-e29b-41d4-a716-446655440000",
    platform: "quest",
    gameVersion: "1.40.8_7379",
    modVersion: "0.1.0-dev",
  }),
});
assert.equal(invalidResponse.status, 400);

const claimResponse = await fetch(`${baseUrl}/api/v1/pairing/claim`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: "04271" }),
});
assert.equal(claimResponse.status, 401);

console.log("OK: health/version, challenge creation and polling, code validation, and unauthenticated claim rejection");
