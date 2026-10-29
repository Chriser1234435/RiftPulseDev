const encoder = new TextEncoder();

/** Verify signed bridge requests; timestamp is Unix seconds and the body must be the exact raw request body. */
export async function verifyTikTokConnectorSignature(
  timestamp: string,
  signature: string,
  rawBody: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  if (!/^\d{10}$/.test(timestamp) || !/^sha256=[a-f0-9]{64}$/i.test(signature) || secret.length < 32) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(now.getTime() / 1000) - seconds) > 300) return false;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + rawBody)));
    const expected = "sha256=" + Array.from(mac, byte => byte.toString(16).padStart(2, "0")).join("");
    let difference = expected.length ^ signature.length;
    for (let i = 0; i < Math.min(expected.length, signature.length); i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return difference === 0;
  } catch {
    return false;
  }
}
