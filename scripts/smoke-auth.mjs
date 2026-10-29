import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const base = "http://127.0.0.1:5173";
const email = "riftpulse-smoke-" + crypto.randomUUID() + "@example.test";
const password = crypto.randomBytes(24).toString("base64url") + "A7!";
const deviceId = "00000000-0000-4000-8000-000000000007";
const originHeaders = { "content-type": "application/json", origin: base };
const checks = [];
let passed = false;

async function check(name, response, predicate = response => response.ok) {
  const ok = predicate(response);
  checks.push({ name, status: response.status, ok });
  if (!ok) {
    const body = await response.clone().text().catch(() => "");
    throw new Error(name + " failed (HTTP " + response.status + ")" + (body ? ": " + body.slice(0, 180) : ""));
  }
  return response;
}

function cleanup() {
  const command = "node_modules\\.bin\\wrangler.cmd d1 execute DB --local --config wrangler.jsonc --file scripts\\cleanup-smoke.sql";
  execFileSync("cmd.exe", ["/d", "/s", "/c", command], { cwd: process.cwd(), stdio: "ignore" });
}

try {
  cleanup();
  const signup = await fetch(base + "/api/auth/sign-up/email", {
    method: "POST", headers: originHeaders, body: JSON.stringify({ name: "Local Smoke Test", email, password }),
  });
  await check("signup", signup);
  const setCookies = signup.headers.getSetCookie?.() ?? [];
  const authCookie = setCookies.find(value => /better-auth\.session_token=/i.test(value));
  if (!authCookie) throw new Error("Sign-up did not issue the expected session cookie");
  if (!/HttpOnly/i.test(authCookie) || !/SameSite=Lax/i.test(authCookie)) throw new Error("Session cookie lacks HttpOnly or SameSite=Lax");
  checks.push({ name: "session_cookie_flags", ok: true });
  const cookie = setCookies.map(value => value.split(";")[0]).filter(Boolean).join("; ");

  const sessionResponse = await fetch(base + "/api/auth/get-session", { headers: { cookie, origin: base } });
  const session = await (await check("session", sessionResponse)).json();
  if (!session?.user?.id) throw new Error("Session response did not include a user");

  const unauthSettings = await fetch(base + "/api/v1/settings/modules");
  await check("unauthenticated_settings_blocked", unauthSettings, response => response.status === 401);

  const settingsResponse = await fetch(base + "/api/v1/settings/modules", { headers: { cookie, origin: base } });
  const settings = await (await check("settings_get", settingsResponse)).json();
  if (!settings.modules?.chat || !settings.modules?.["bsr-song-request"]) throw new Error("Both V1 module settings were not returned");

  const rejectedOrigin = await fetch(base + "/api/v1/settings/modules/bsr-song-request", {
    method: "PATCH", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ settings: { command: "!blocked" } }),
  });
  await check("settings_origin_guard", rejectedOrigin, response => response.status === 403);

  const patch = await fetch(base + "/api/v1/settings/modules/bsr-song-request", {
    method: "PATCH", headers: { ...originHeaders, cookie },
    body: JSON.stringify({ settings: { command: "!smoke" } }),
  });
  await check("settings_patch", patch);
  const reload = await fetch(base + "/api/v1/settings/modules", { headers: { cookie, origin: base } });
  const reloaded = await (await check("settings_persist", reload)).json();
  if (reloaded.modules?.["bsr-song-request"]?.settings?.command !== "!smoke") throw new Error("Saved BSR command was not persisted");

  const code = String(crypto.randomInt(0, 100000)).padStart(5, "0");
  const challengeResponse = await fetch(base + "/api/v1/pairing/challenges", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceId, platform: "quest", gameVersion: "1.40.8_7379", modVersion: "0.1.0-dev" }),
  });
  await check("mod_generated_challenge", challengeResponse, response => response.status === 201);
  const challenge = await challengeResponse.json();
  if ("code" in challenge) throw new Error("Challenge endpoint unexpectedly returned the raw code");

  const noOriginClaim = await fetch(base + "/api/v1/pairing/claim", {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ code }),
  });
  await check("pairing_origin_guard", noOriginClaim, response => response.status === 403);

  const claimResponse = await fetch(base + "/api/v1/pairing/claim", {
    method: "POST", headers: { ...originHeaders, cookie }, body: JSON.stringify({ code }),
  });
  const claim = await (await check("authenticated_pairing_claim", claimResponse)).json();
  if (claim.deviceId !== deviceId) throw new Error("Claimed device ID did not match the mod challenge");

  const devicesResponse = await fetch(base + "/api/v1/devices", { headers: { cookie, origin: base } });
  const devices = await (await check("device_list", devicesResponse)).json();
  if (!devices.devices?.some(device => device.id === deviceId && device.gameVersion === "1.40.8_7379")) throw new Error("Claimed device was not listed");

  const revokeResponse = await fetch(base + "/api/v1/devices/" + deviceId, { method: "DELETE", headers: { ...originHeaders, cookie } });
  await check("device_revoke", revokeResponse);
  const afterRevoke = await (await fetch(base + "/api/v1/devices", { headers: { cookie, origin: base } })).json();
  if (afterRevoke.devices?.some(device => device.id === deviceId)) throw new Error("Revoked device still appears as active");

  const signOut = await fetch(base + "/api/auth/sign-out", { method: "POST", headers: { ...originHeaders, cookie }, body: "{}" });
  await check("sign_out", signOut);
  const clearedCookies = signOut.headers.getSetCookie?.() ?? [];
  if (!clearedCookies.some(value => /better-auth\.session_token=/i.test(value) && (/Max-Age=0/i.test(value) || /Expires=/i.test(value)))) {
    throw new Error("Sign-out did not return a cleared session cookie");
  }
  checks.push({ name: "sign_out_cookie_clear", ok: true });
  passed = true;
} catch (error) {
  checks.push({ name: "fatal", ok: false, error: error instanceof Error ? error.message : "Unknown error" });
} finally {
  try { cleanup(); checks.push({ name: "smoke_account_cleanup", ok: true }); }
  catch (error) { checks.push({ name: "smoke_account_cleanup", ok: false, error: error instanceof Error ? error.message : "Cleanup failed" }); passed = false; }
}

console.log(JSON.stringify({ ok: passed && checks.every(item => item.ok), checks }, null, 2));
if (!passed || checks.some(item => !item.ok)) process.exitCode = 1;
