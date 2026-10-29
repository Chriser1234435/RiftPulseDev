export interface TwitchEventSubSignatureInput {
  messageId: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}

/** Verifies Twitch EventSub's HMAC-SHA256 over message ID + timestamp + exact raw body. */
export async function verifyTwitchEventSubSignature(
  input: TwitchEventSubSignatureInput,
  secret: string,
  now = new Date(),
  maxSkewMs = 10 * 60 * 1000,
): Promise<boolean> {
  const { messageId, timestamp, signature, rawBody } = input;
  if (!messageId || messageId.length > 128 || !timestamp || !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  if (!secret || secret.length < 10 || secret.length > 100 || !Number.isFinite(maxSkewMs) || maxSkewMs < 0) return false;
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > maxSkewMs) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const expected = new Uint8Array(new ArrayBuffer(32));
    const hex = signature.slice(7);
    for (let i = 0; i < 32; i++) expected[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const message = new TextEncoder().encode(messageId + timestamp + rawBody);
    return await crypto.subtle.verify("HMAC", key, expected, message);
  } catch {
    return false;
  }
}
