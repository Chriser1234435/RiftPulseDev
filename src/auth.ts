import { betterAuth } from "better-auth";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./env.ts";

type AuthInstance = any;
const cache = new WeakMap<object, AuthInstance>();

export function createAuth(env: Env): AuthInstance | null {
  if (!env.DB || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) return null;

  const baseURL = env.APP_BASE_URL ?? "http://127.0.0.1:5173";
  const isLocal = baseURL.startsWith("http://localhost:") || baseURL.startsWith("http://127.0.0.1:");
  // This step only enables account creation on localhost. Remote auth stays disabled
  // until email verification delivery, origin allowlisting, and production review exist.
  if (!isLocal) return null;

  const key = env.DB as object;
  const cached = cache.get(key);
  if (cached) return cached;

  const auth = betterAuth({
    appName: "RiftPulse",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: (env.TRUSTED_ORIGINS ?? baseURL).split(",").map(value => value.trim()).filter(Boolean),
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
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: { enabled: true },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: false,
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
