import { z } from 'zod';

/** Parse, don't cast: the process refuses to boot on invalid configuration. */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(47100),
  DATABASE_URL: z
    .string()
    .default('postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch'),
  DB_DRIVER: z
    .enum(['node-postgres', 'neon-http'])
    .default(process.env.VERCEL ? 'neon-http' : 'node-postgres'),
  APP_BASE_DOMAIN: z.string().default('localhost'),
  APP_BASE_URL: z.string().url().optional(),
  // Injected by Vercel into every deployment; previews derive their base URL
  // and trusted auth origin from these instead of per-branch env vars.
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(16).default('dev-only-secret-do-not-use-in-prod'),
  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WEB_DIST_DIR: z.string().default('dist/web'),
});

export type Env = z.output<typeof envSchema> & { APP_BASE_URL: string };

export const loadEnv = (): Env => {
  const parsed = envSchema.safeParse(process.env);
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
