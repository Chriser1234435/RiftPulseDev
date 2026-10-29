import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./env.ts";

type AuthInstance = any;
const cache = new WeakMap<object, AuthInstance>();

export function createAuth(env: Env): AuthInstance | null {
  if (!env.DB || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) return null;

  const baseURL = env.APP_BASE_URL ?? "http://127.0.0.1:5173";
  const isLocal = baseURL.startsWith("http://localhost:") || baseURL.startsWith("http://127.0.0.1:");
  const configuredOrigins = (env.TRUSTED_ORIGINS ?? baseURL).split(",").map(value => value.trim()).filter(Boolean);

  // Remote sign-up is allowed only for an explicitly enabled, HTTPS workers.dev
  // preview. This is a development-only account system, not production auth:
  // email verification delivery and a production-domain review are still required.
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
      // Remote preview accounts are temporary test accounts. Production must
      // enable verification and configure a real verification-email delivery path.
      requireEmailVerification: false,
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
