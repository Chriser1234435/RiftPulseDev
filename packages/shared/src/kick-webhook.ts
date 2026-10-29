export interface KickWebhookSignatureInput {
  messageId: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
}

export function extractKickPublicKey(responseText: string): string | null {
  let candidate = responseText.trim();
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const root = parsed as Record<string, unknown>;
      const data = typeof root.data === "object" && root.data !== null && !Array.isArray(root.data)
        ? root.data as Record<string, unknown> : {};
      const values = [data.public_key, data.publicKey, root.public_key, root.publicKey, root.key];
      const found = values.find(value => typeof value === "string");
      candidate = typeof found === "string" ? found.trim() : "";
    }
  } catch {
    // Kick may return the PEM itself as plain text.
  }
  return candidate.includes("-----BEGIN PUBLIC KEY-----") && candidate.includes("-----END PUBLIC KEY-----")
    ? candidate : null;
}

/** Verifies Kick's documented RSA-SHA256 signature over messageId.timestamp.rawBody. */
export async function verifyKickWebhookSignature(
  input: KickWebhookSignatureInput,
  publicKeyPem: string,
  now = new Date(),
  maxSkewMs = 5 * 60 * 1000,
): Promise<boolean> {
  const { messageId, timestamp, signature, rawBody } = input;
  if (!messageId || messageId.length > 128 || !timestamp || !signature || signature.length > 2048) return false;
  if (!Number.isFinite(maxSkewMs) || maxSkewMs < 0) return false;
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > maxSkewMs) return false;
  if (!publicKeyPem.includes("-----BEGIN PUBLIC KEY-----") || !publicKeyPem.includes("-----END PUBLIC KEY-----")) return false;
  try {
    const base64Key = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
    const keyBytes = decodeBase64(base64Key);
    const signatureBytes = decodeBase64(signature);
    const key = await crypto.subtle.importKey(
      "spki", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const signedContent = new TextEncoder().encode(messageId + "." + timestamp + "." + rawBody);
    return await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signatureBytes, signedContent);
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
