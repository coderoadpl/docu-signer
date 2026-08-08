import { z } from 'zod';

import { DEV_ONLY_SECRET, serverEnvSchema, type ServerEnvParsed } from '#core/server/config.js';

export { DEV_ONLY_SECRET };

// Production hardening: outside local dev the schema refuses dev-only config.
// "Deployed" = running on Vercel (VERCEL set) OR hardened cookies on (a
// self-host prod turns SECURE_COOKIES on), so local dev and the smoke/e2e
// harnesses (neither set) are never subject to these rules.
const envSchema = serverEnvSchema.superRefine((data, ctx) => {
  const deployed = data.VERCEL !== undefined || data.SECURE_COOKIES;
  if (deployed && data.BETTER_AUTH_SECRET === DEV_ONLY_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['BETTER_AUTH_SECRET'],
      message: 'BETTER_AUTH_SECRET must be overridden with real entropy outside local dev',
    });
  }
  if (deployed && !data.SECURE_COOKIES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SECURE_COOKIES'],
      message: 'SECURE_COOKIES must be true outside local dev',
    });
  }
  if (data.VERCEL !== undefined && data.DB_DRIVER !== 'neon-http') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DB_DRIVER'],
      message: 'DB_DRIVER must be neon-http on Vercel',
    });
  }
});

export type Env = ServerEnvParsed & { APP_BASE_URL: string };

/** Pure boundary parse (no process.exit) so both success and refusal are unit-testable. */
export const parseEnv = (source: NodeJS.ProcessEnv = process.env) => envSchema.safeParse(source);

export const loadEnv = (): Env => {
  const parsed = parseEnv();
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  // Environment precedence for the public base URL: explicit APP_BASE_URL
  // (production alias) → the deployment's own Vercel URL (previews/staging,
  // no per-branch vars needed) → local dev.
  const APP_BASE_URL =
    parsed.data.APP_BASE_URL ??
    (parsed.data.VERCEL_URL ? `https://${parsed.data.VERCEL_URL}` : 'http://localhost:47100');
  return { ...parsed.data, APP_BASE_URL };
};
