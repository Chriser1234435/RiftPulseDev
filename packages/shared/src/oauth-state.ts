export async function digestOAuthState(state: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(state)) throw new Error("invalid_oauth_state");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
