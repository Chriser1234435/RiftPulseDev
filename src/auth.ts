import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./env.ts";

type AuthInstance = any;
const cache = new WeakMap<object, AuthInstance>();

async function sendPasswordResetEmail(env: Env, to: string, resetUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new Error("Password-reset email delivery is not configured for this preview.");
  }
  const safeUrl = resetUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [to],
      subject: "Reset your RiftPulse preview password",
      text: `A password reset was requested for your RiftPulse account. Use this one-time link to choose a new password: ${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html: `<p>A password reset was requested for your RiftPulse preview account.</p><p><a href="${safeUrl}">Choose a new password</a></p><p>If you did not request this, ignore this email.</p>`,
    }),
  });
  const payload = await response.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
  if (!response.ok || !payload?.id) {
    throw new Error(payload?.message || payload?.name || `Resend rejected the message (HTTP ${response.status}).`);
  }
}

export function createAuth(env: Env): AuthInstance | null {
  if (!env.DB || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) return null;

  const baseURL = env.APP_BASE_URL ?? "http://127.0.0.1:5173";
  const isLocal = baseURL.startsWith("http://localhost:") || baseURL.startsWith("http://127.0.0.1:");
  const configuredOrigins = (env.TRUSTED_ORIGINS ?? baseURL).split(",").map(value => value.trim()).filter(Boolean);

  let isAllowedRemotePreview = false;
  try {
    const origin = new URL(baseURL);
    isAllowedRemotePreview = env.ALLOW_REMOTE_DEV_AUTH === "true"
      && origin.protocol === "https:"
      && origin.hostname.endsWith(".workers.dev")
      && !origin.username
      && !origin.password
      && origin.pathname === "/"
      && !origin.search
      && !origin.hash
      && configuredOrigins.length === 1
      && configuredOrigins[0] === origin.origin;
  } catch {
    isAllowedRemotePreview = false;
  }
  if (!isLocal && !isAllowedRemotePreview) return null;

  const key = env.DB as object;
  const cached = cache.get(key);
  if (cached) return cached;

  const auth = betterAuth({
    appName: "RiftPulse",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: configuredOrigins,
    database: {
      dialect: new D1Dialect({ database: env.DB as never }),
      type: "sqlite",
      transaction: false,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendPasswordResetEmail(env, user.email, url);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: true },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: !isLocal,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const now = new Date().toISOString();
            const result = await env.DB!.prepare(
              "INSERT OR IGNORE INTO accounts (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)",
            ).bind(user.id, now, now).run();
            if (!result.success) throw new Error("Could not initialize RiftPulse account profile.");
          },
        },
      },
    },
  });

  cache.set(key, auth as AuthInstance);
  return auth;
}
