import test from "node:test";
import assert from "node:assert/strict";
import { digestPairingCode } from "../../packages/shared/src/pairing.ts";

test("pairing code digest is deterministic for the same key and code", async () => {
  const first = await digestPairingCode("04271", "local-test-key-that-is-long-enough-32chars");
  const second = await digestPairingCode("04271", "local-test-key-that-is-long-enough-32chars");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("pairing digest is keyed and does not equal the raw five-digit code", async () => {
  const first = await digestPairingCode("04271", "local-test-key-that-is-long-enough-32chars");
  const second = await digestPairingCode("04271", "different-local-test-key-that-is-long-enough");
  assert.notEqual(first, second);
  assert.notEqual(first, "04271");
});

test("different five-digit codes produce different HMAC digests", async () => {
  const first = await digestPairingCode("04271", "local-test-key-that-is-long-enough-32chars");
  const second = await digestPairingCode("04272", "local-test-key-that-is-long-enough-32chars");
  assert.notEqual(first, second);
});
