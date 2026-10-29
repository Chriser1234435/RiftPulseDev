import assert from "node:assert/strict";
import test from "node:test";
import {
  API_VERSION, SUPPORTED_MODULES, PROVIDERS, isModuleKey, isProviderKey,
  validateClaimPairing, validateCreatePairingChallenge,
} from "../../packages/contracts/src/v1.ts";

test("exports the intended V1 modules and providers", () => {
  assert.equal(API_VERSION, "v1");
  assert.deepEqual(SUPPORTED_MODULES, ["chat", "bsr-song-request"]);
  assert.deepEqual(PROVIDERS, ["twitch", "youtube", "kick", "tiktok"]);
  assert.equal(isModuleKey("chat"), true);
  assert.equal(isModuleKey("legacy-module"), false);
  assert.equal(isProviderKey("tiktok"), true);
  assert.equal(isProviderKey("unknown"), false);
});

test("accepts a well-formed five-digit mod-generated pairing challenge", () => {
  const result = validateCreatePairingChallenge({
    code: "00427", deviceId: "550e8400-e29b-41d4-a716-446655440000",
    platform: "quest", gameVersion: "1.40.8_7379", modVersion: "0.1.0-dev",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.code, "00427");
    assert.equal(result.value.platform, "quest");
  }
});

test("rejects malformed codes, identifiers, platform names and oversized versions", () => {
  for (const code of ["1234", "123456", "12a45", "", " 1234"]) {
    assert.equal(validateClaimPairing({ code }).ok, false, `rejected code: ${code}`);
  }
  assert.equal(validateCreatePairingChallenge({
    code: "12345", deviceId: "not-a-uuid", platform: "android",
    gameVersion: "x".repeat(65), modVersion: "",
  }).ok, false);
});

test("claim request only accepts a string with exactly five digits", () => {
  assert.deepEqual(validateClaimPairing({ code: "00001" }), { ok: true, value: { code: "00001" } });
  assert.equal(validateClaimPairing({ code: 12345 }).ok, false);
  assert.equal(validateClaimPairing(null).ok, false);
});
