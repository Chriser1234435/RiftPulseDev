const PREFIX = "v1";
const MAX_TOKEN_LENGTH = 8192;

/** AES-256-GCM token envelope: v1.<base64url nonce>.<base64url ciphertext+tag>. */
export async function encryptProviderToken(token: string, keyBase64: string): Promise<string> {
  if (typeof token !== "string" || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
    throw new Error("invalid_token");
  }
  const keyBytes = decodeEncryptionKey(keyBase64);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const nonce = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(nonce);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(token),
  );
  return PREFIX + "." + encodeBase64Url(nonce) + "." + encodeBase64Url(new Uint8Array(ciphertext));
}

export async function decryptProviderToken(envelope: string, keyBase64: string): Promise<string> {
  const parts = envelope.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error("invalid_token_envelope");
  const keyBytes = decodeEncryptionKey(keyBase64);
  const nonce = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  if (nonce.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > MAX_TOKEN_LENGTH + 16) {
    throw new Error("invalid_token_envelope");
  }
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("token_decryption_failed");
  }
}

function decodeEncryptionKey(value: string): Uint8Array<ArrayBuffer> {
  try {
    const key = decodeBase64(value);
    if (key.byteLength === 32) return key;
  } catch {
    // Normalize all malformed key encodings to one safe error.
  }
  throw new Error("invalid_token_encryption_key");
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(value)) throw new Error("invalid_base64");
  const standard = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_token_envelope");
  return decodeBase64(value);
}

function encodeBase64Url(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
