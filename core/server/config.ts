import { z } from 'zod';

import { DEFAULT_DEV_PORT } from '#core/contract/index.js';

/**
 * The single source of environment configuration (DECIDE F4). One module owns
 * every env key and its parse rule; the runtime server, the migrate/seed
 * composition points and observability each consume a command-specific subset,
 * so no two entry points can drift on a default or on the driver rule.
 *
 * The schemas are the shared field definitions; command-specific refinements
 * (e.g. the production hardening in `apps/server/src/env.ts`) layer on at the
 * consuming edge.
 */

export const DEFAULT_DATABASE_URL =
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const DEFAULT_BACKUP_BLOB_MONTHLY_CEILING = 5_000_000_000;
const DEFAULT_BACKUP_DATABASE_DAILY_MAX = 100_000_000;

/** The placeholder secret that ships in `.env.example`; refused on any deploy. */
export const DEV_ONLY_SECRET = 'dev-only-secret-do-not-use-in-prod';

const dbDriverSchema = z.enum(['node-postgres', 'neon-http']);

const databaseUrlField = z.string().default(DEFAULT_DATABASE_URL);
const appBaseDomainField = z.string().trim().min(1).transform((value) => value.toLowerCase());
const positiveBytes = (fallback: number): z.ZodType<number> =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().int().positive().safe(),
  );

// Platform-follows default read once at load: neon-http under Vercel, node-postgres
// otherwise — an explicit DB_DRIVER always wins. Shared so the runtime server and
// the build-time migrate/seed points resolve the driver identically.
const dbDriverField = dbDriverSchema.default(
  process.env.VERCEL ? 'neon-http' : 'node-postgres',
);

/** Runtime server env — the full set the Hono process boots on. */
export const serverEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(DEFAULT_DEV_PORT),
  // Self-host only: the private port the internal control-plane app binds
  // (Caddy's on-demand-TLS `ask` endpoint). Set exclusively in the compose
  // stack, where it is reachable only on the container network and never
  // published; unset elsewhere, so the internal app does not start (dev, smoke,
  // e2e and Vercel never expose the domain-check surface).
  INTERNAL_PORT: z.coerce.number().int().positive().optional(),
  DATABASE_URL: databaseUrlField,
  DB_DRIVER: dbDriverField,
  APP_BASE_DOMAIN: appBaseDomainField.default('localhost'),
  APP_BASE_URL: z.url().optional(),
  // Set by Vercel on every deployment (`VERCEL=1`). Presence is the "we are
  // deployed on Vercel" signal the hardening refinements key off.
  VERCEL: z.string().optional(),
  // Injected by Vercel into every deployment; previews derive their base URL
  // and trusted auth origin from these instead of per-branch env vars.
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  // Vendor-neutral build attestation (mapped from VERCEL_GIT_COMMIT_SHA in the
  // platform entry so the vendor name stays contained); surfaced by /api/health*.
  APP_COMMIT_SHA: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_ONLY_SECRET),
  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Off only in test harnesses: the e2e suite drives many sign-ins from a
  // single rate-limit bucket (no client IP behind the harness).
  AUTH_RATE_LIMIT: z
    .enum(['on', 'off'])
    .default('on')
    .transform((value) => value === 'on'),
  AUTH_DISABLE_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  STORAGE_DRIVER: z.enum(['local-fs', 'vercel-blob']).default('local-fs'),
  STORAGE_LOCAL_PATH: z.string().default('/tmp/podpisy-storage'),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  SEAL_CERT_PEM: z.string().min(1).optional(),
  SEAL_KEY_PEM: z.string().min(1).optional(),
  SEAL_P12_BASE64: z.string().min(1).optional(),
  SEAL_P12_PASSPHRASE: z.string().default(''),
  // Email transport selector (composition root). `smtp` uses any explicitly
  // configured RFC SMTP relay; when its settings are absent, composition uses a
  // no-op port by design so invitations remain creatable through the UI's
  // copy-link fallback. `ses` selects Amazon SES directly over the SESv2 HTTP API.
  EMAIL_TRANSPORT: z.enum(['smtp', 'ses']).default('smtp'),
  MAIL_FROM: z.string().trim().min(1).optional(),
  // SMTP settings are optional as a complete block; authentication stays
  // optional because local capture servers and other open relays need no creds.
  SMTP_HOST: z.string().trim().min(1).optional(),
  SMTP_PORT: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Amazon SES direct (EMAIL_TRANSPORT=ses) — standard AWS credential env names,
  // read only by the SES email adapter's composition. Required only when `ses`
  // is selected; the AWS SDK vendor is contained to adapters/email by depcruise.
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Google social sign-in (FR-26), wired only when BOTH are present — the same
  // present-both-or-dormant gating as SENTRY_DSN. Absent = the provider is off
  // and the web login page hides its button.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  WEB_DIST_DIR: z.string().default('dist/web'),
});

export type ServerEnvParsed = z.output<typeof serverEnvSchema>;

/** Migration subset: connection string + driver selection only. */
export const databaseEnvSchema = z.object({
  DATABASE_URL: databaseUrlField,
  DB_DRIVER: dbDriverField,
});

const seedAdminEnvFields = {
  SEED_ADMIN1_EMAIL: z.email().optional(),
  SEED_ADMIN1_PASSWORD: z.string().min(8).optional(),
};

interface SeedAdminEnv {
  SEED_ADMIN1_EMAIL?: string | undefined;
  SEED_ADMIN1_PASSWORD?: string | undefined;
}

const validateSeedAdminEnv = (data: SeedAdminEnv, ctx: z.RefinementCtx): void => {
  const email = data.SEED_ADMIN1_EMAIL;
  const password = data.SEED_ADMIN1_PASSWORD;
  if ((email === undefined) !== (password === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: [`SEED_ADMIN1_${email === undefined ? 'EMAIL' : 'PASSWORD'}`],
      message: 'SEED_ADMIN1_EMAIL and SEED_ADMIN1_PASSWORD must be set together',
    });
  }
};

/** Deploy seed subset: connection selection + optional admin credentials and host binding. */
export const deploySeedEnvSchema = z
  .object({
    ...databaseEnvSchema.shape,
    APP_BASE_DOMAIN: appBaseDomainField.optional(),
    ...seedAdminEnvFields,
  })
  .superRefine(validateSeedAdminEnv);

/** Dev seed subset: deploy seed fields + the auth secret used for demo signup. */
export const seedEnvSchema = z
  .object({
    ...databaseEnvSchema.shape,
    BETTER_AUTH_SECRET: z.string().default(DEV_ONLY_SECRET),
  });

export const backupEnvSchema = z.object({
  NEON_DATABASE_URL_UNPOOLED: z.url(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  GOOGLE_DRIVE_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]+$/),
  BACKUP_BLOB_MONTHLY_DOWNLOAD_LIMIT_BYTES: positiveBytes(DEFAULT_BACKUP_BLOB_MONTHLY_CEILING),
  BACKUP_DATABASE_DAILY_MAX_BYTES: positiveBytes(DEFAULT_BACKUP_DATABASE_DAILY_MAX),
});

/**
 * Observability subset. All optional — absent = no-op (dev/CI untouched):
 * an OTLP endpoint gates the tracer provider; `SENTRY_DSN` gates the Sentry
 * error sink. Each vendor is wired only when its key is present.
 */
export const observabilityEnvSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('agentproofarch-server'),
  SENTRY_DSN: z.string().optional(),
});
