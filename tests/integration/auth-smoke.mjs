import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.RIFTPULSE_BASE_URL ?? "http://127.0.0.1:5173";
const origin = new URL(base).origin;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const vars = readFileSync(join(root, ".dev.vars"), "utf8");
const pairingKey = vars.match(/^PAIRING_HMAC_KEY=(.+)$/m)?.[1];
assert.ok(pairingKey && pairingKey.length >= 32, "local pairing secret is missing");
const email = `test-${Date.now()}@riftpulse.invalid`;
const password = "LocalOnly-TestPass-82!";

const signup = await fetch(`${base}/api/auth/sign-up/email`, {
  method: "POST", headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ name: "Local Test", email, password }),
});
const signupBody = await signup.json().catch(() => ({}));
assert.equal(signup.status, 200, `signup failed (${signup.status}): ${JSON.stringify(signupBody)}`);
const setCookies = signup.headers.getSetCookie?.() ?? [];
assert.ok(setCookies.some(value => /httponly/i.test(value)), "session cookie must be HttpOnly");
assert.ok(setCookies.some(value => /samesite=lax/i.test(value)), "session cookie must use SameSite=Lax");
const cookie = setCookies.map(value => value.split(";")[0]).filter(Boolean).join("; ");
assert.ok(cookie, "signup did not issue a session cookie");

const sessionResponse = await fetch(`${base}/api/auth/get-session`, { headers: { cookie, origin } });
assert.equal(sessionResponse.status, 200);
const session = await sessionResponse.json();
assert.equal(session.user.email, email);
assert.ok(session.session.id);

const settingsResponse = await fetch(`${base}/api/v1/settings/modules`, { headers: { cookie, origin } });
assert.equal(settingsResponse.status, 200, await settingsResponse.clone().text());
const initialSettings = await settingsResponse.json();
assert.equal(initialSettings.modules.chat.enabled, true);
assert.equal(initialSettings.modules["bsr-song-request"].enabled, true);

const noOriginPatch = await fetch(`${base}/api/v1/settings/modules/chat`, {
  method: "PATCH", headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ enabled: false }),
});
assert.equal(noOriginPatch.status, 403, "cookie-authenticated mutations must reject missing Origin");

const disableChat = await fetch(`${base}/api/v1/settings/modules/chat`, {
  method: "PATCH", headers: { cookie, origin, "content-type": "application/json" },
  body: JSON.stringify({ enabled: false }),
});
assert.equal(disableChat.status, 200, await disableChat.clone().text());
assert.equal((await disableChat.json()).enabled, false);

const saveCommand = await fetch(`${base}/api/v1/settings/modules/bsr-song-request`, {
  method: "PATCH", headers: { cookie, origin, "content-type": "application/json" },
  body: JSON.stringify({ settings: { command: "!songs" } }),
});
assert.equal(saveCommand.status, 200, await saveCommand.clone().text());
const settingsAgain = await (await fetch(`${base}/api/v1/settings/modules`, { headers: { cookie, origin } })).json();
assert.equal(settingsAgain.modules.chat.enabled, false);
assert.equal(settingsAgain.modules["bsr-song-request"].settings.command, "!songs");

const noDevices = await fetch(`${base}/api/v1/devices`, { headers: { cookie, origin } });
assert.equal(noDevices.status, 200);
assert.deepEqual((await noDevices.json()).devices, []);

const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(5, "0");
const deviceId = crypto.randomUUID();
const challengeResponse = await fetch(`${base}/api/v1/pairing/challenges`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, deviceId, platform: "quest", gameVersion: "1.40.8_7379", modVersion: "0.1.0-dev" }),
});
assert.equal(challengeResponse.status, 201, await challengeResponse.clone().text());
const challenge = await challengeResponse.json();
assert.equal("code" in challenge, false);

const anonymousClaim = await fetch(`${base}/api/v1/pairing/claim`, {
  method: "POST", headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ code }),
});
assert.equal(anonymousClaim.status, 401, await anonymousClaim.text());

const claim = await fetch(`${base}/api/v1/pairing/claim`, {
  method: "POST", headers: { "content-type": "application/json", origin, cookie },
  body: JSON.stringify({ code }),
});
assert.equal(claim.status, 200, await claim.clone().text());
assert.deepEqual(await claim.json(), { status: "claimed", deviceId, platform: "quest" });

const challengeStatus = await fetch(`${base}/api/v1/pairing/challenges/${challenge.challengeId}`);
assert.equal((await challengeStatus.json()).status, "claimed");
const pairedDevices = await (await fetch(`${base}/api/v1/devices`, { headers: { cookie, origin } })).json();
assert.equal(pairedDevices.devices.length, 1);
assert.equal(pairedDevices.devices[0].id, deviceId);
assert.equal(pairedDevices.devices[0].gameVersion, "1.40.8_7379");

const noOriginRevoke = await fetch(`${base}/api/v1/devices/${deviceId}`, { method: "DELETE", headers: { cookie } });
assert.equal(noOriginRevoke.status, 403);
const revoke = await fetch(`${base}/api/v1/devices/${deviceId}`, { method: "DELETE", headers: { cookie, origin } });
assert.equal(revoke.status, 200, await revoke.clone().text());
assert.equal((await revoke.json()).status, "revoked");
assert.deepEqual((await (await fetch(`${base}/api/v1/devices`, { headers: { cookie, origin } })).json()).devices, []);
assert.equal((await (await fetch(`${base}/api/v1/pairing/challenges/${challenge.challengeId}`)).json()).status, "revoked");

const signout = await fetch(`${base}/api/auth/sign-out`, {
  method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}",
});
assert.equal(signout.status, 200, await signout.text());
const afterSignout = await fetch(`${base}/api/auth/get-session`, { headers: { cookie, origin } });
assert.equal(afterSignout.status, 200);
assert.equal(await afterSignout.json(), null);

console.log("OK: sign-up/session, CSRF origin checks, persisted module settings, one-time device claim/list/revoke, and sign-out");
