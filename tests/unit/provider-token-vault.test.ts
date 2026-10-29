import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptProviderToken, encryptProviderToken } from "../../packages/shared/src/provider-token-vault.ts";

test("AES-256-GCM token envelope round-trips without storing plaintext", async () => {
  const key = randomBytes(32).toString("base64");
  const token = "provider-access-token-test-value";
  const encrypted = await encryptProviderToken(token, key);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes(token), false);
  assert.equal(await decryptProviderToken(encrypted, key), token);
  assert.notEqual(await encryptProviderToken(token, key), encrypted, "random nonces should produce different ciphertext");
});

test("token vault rejects malformed envelopes, wrong keys, and tampering", async () => {
  const key = randomBytes(32).toString("base64");
  const otherKey = randomBytes(32).toString("base64");
  const encrypted = await encryptProviderToken("sensitive-token", key);
  await assert.rejects(() => decryptProviderToken(encrypted, otherKey), /token_decryption_failed/);
  const parts = encrypted.split(".");
  parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
  await assert.rejects(() => decryptProviderToken(parts.join("."), key));
  await assert.rejects(() => decryptProviderToken("not-an-envelope", key), /invalid_token_envelope/);
  await assert.rejects(() => encryptProviderToken("token", "short"), /invalid_token_encryption_key/);
});

test("token vault enforces token size bounds", async () => {
  const key = randomBytes(32).toString("base64");
  await assert.rejects(() => encryptProviderToken("", key), /invalid_token/);
  await assert.rejects(() => encryptProviderToken("x".repeat(8193), key), /invalid_token/);
});
