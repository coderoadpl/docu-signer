import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DATABASE_URL,
  databaseEnvSchema,
  observabilityEnvSchema,
  seedEnvSchema,
} from '#core/server/config.js';

import { DEV_ONLY_SECRET, loadEnv, parseEnv } from './env.js';

beforeEach(() => {
  vi.stubEnv('AUTH_RATE_LIMIT', undefined);
  vi.stubEnv('APP_BASE_URL', undefined);
  vi.stubEnv('VERCEL_URL', undefined);
  vi.stubEnv('SECURE_COOKIES', undefined);
  vi.stubEnv('TENANT_CREATION', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadEnv', () => {
  it('keeps the auth rate limiter on by default', () => {
    expect(loadEnv().AUTH_RATE_LIMIT).toBe(true);
  });

  it('turns the limiter off only on the explicit harness knob', () => {
    vi.stubEnv('AUTH_RATE_LIMIT', 'off');
    expect(loadEnv().AUTH_RATE_LIMIT).toBe(false);
  });

  it('derives the base URL from VERCEL_URL when APP_BASE_URL is unset', () => {
    vi.stubEnv('VERCEL_URL', 'preview-abc.vercel.app');
    expect(loadEnv().APP_BASE_URL).toBe('https://preview-abc.vercel.app');
  });

  it('prefers an explicit APP_BASE_URL over the deployment URL', () => {
    vi.stubEnv('VERCEL_URL', 'preview-abc.vercel.app');
    vi.stubEnv('APP_BASE_URL', 'https://agentproofarch.vercel.app');
    expect(loadEnv().APP_BASE_URL).toBe('https://agentproofarch.vercel.app');
  });

  it('parses SECURE_COOKIES as a boolean flag', () => {
    vi.stubEnv('SECURE_COOKIES', 'true');
    // A non-Vercel deploy with hardened cookies must supply a real secret.
    vi.stubEnv('BETTER_AUTH_SECRET', 'a-real-production-secret-value');
    expect(loadEnv().SECURE_COOKIES).toBe(true);
  });

  it('exposes the commit SHA when set, undefined otherwise', () => {
    expect(loadEnv().APP_COMMIT_SHA).toBeUndefined();
    vi.stubEnv('APP_COMMIT_SHA', 'deadbeef');
    expect(loadEnv().APP_COMMIT_SHA).toBe('deadbeef');
  });

  it('defaults tenant creation to open and accepts only declared modes', () => {
    expect(loadEnv().TENANT_CREATION).toBe('open');
    expect(parseEnv({ ...localDev(), TENANT_CREATION: 'staff' }).success).toBe(true);
    expect(parseEnv({ ...localDev(), TENANT_CREATION: 'closed' }).success).toBe(true);
    expect(parseEnv({ ...localDev(), TENANT_CREATION: 'invalid' }).success).toBe(false);
  });
});

// A minimal source that parses clean in local dev (neither deploy signal set).
const localDev = (): NodeJS.ProcessEnv => ({
  DB_DRIVER: 'node-postgres',
  BETTER_AUTH_SECRET: DEV_ONLY_SECRET,
});

// A minimal source that parses clean once deployed on Vercel.
const deployed = (): NodeJS.ProcessEnv => ({
  VERCEL: '1',
  DB_DRIVER: 'neon-http',
  SECURE_COOKIES: 'true',
  BETTER_AUTH_SECRET: 'a-real-production-secret-value',
});

describe('production env hardening (B2)', () => {
  it('accepts the dev-only defaults in local dev', () => {
    expect(parseEnv(localDev()).success).toBe(true);
  });

  it('accepts a fully hardened Vercel deployment', () => {
    expect(parseEnv(deployed()).success).toBe(true);
  });

  describe('the dev-only BETTER_AUTH_SECRET sentinel', () => {
    it('is allowed in local dev', () => {
      expect(parseEnv({ ...localDev(), BETTER_AUTH_SECRET: DEV_ONLY_SECRET }).success).toBe(true);
    });

    it('is refused on Vercel', () => {
      const result = parseEnv({ ...deployed(), BETTER_AUTH_SECRET: DEV_ONLY_SECRET });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.BETTER_AUTH_SECRET).toBeDefined();
      }
    });

    it('is refused whenever SECURE_COOKIES is on (self-host prod)', () => {
      const result = parseEnv({
        DB_DRIVER: 'node-postgres',
        SECURE_COOKIES: 'true',
        BETTER_AUTH_SECRET: DEV_ONLY_SECRET,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SECURE_COOKIES=false', () => {
    it('is allowed in local dev', () => {
      expect(parseEnv({ ...localDev(), SECURE_COOKIES: 'false' }).success).toBe(true);
    });

    it('is refused on Vercel', () => {
      const result = parseEnv({ ...deployed(), SECURE_COOKIES: 'false' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.SECURE_COOKIES).toBeDefined();
      }
    });
  });

  describe('DB_DRIVER on Vercel', () => {
    it('accepts neon-http', () => {
      expect(parseEnv({ ...deployed(), DB_DRIVER: 'neon-http' }).success).toBe(true);
    });

    it('refuses node-postgres', () => {
      const result = parseEnv({ ...deployed(), DB_DRIVER: 'node-postgres' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.DB_DRIVER).toBeDefined();
      }
    });

    it('leaves node-postgres untouched off Vercel', () => {
      expect(parseEnv({ ...localDev(), DB_DRIVER: 'node-postgres' }).success).toBe(true);
    });
  });
});

describe('domain provisioner selection (US-020)', () => {
  it('defaults to noop and leaves the Vercel credential block unset', () => {
    const result = parseEnv(localDev());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DOMAIN_PROVISIONER).toBe('noop');
      expect(result.data.VERCEL_TOKEN).toBeUndefined();
      expect(result.data.VERCEL_PROJECT_ID).toBeUndefined();
      expect(result.data.VERCEL_TEAM_ID).toBeUndefined();
    }
  });

  it('takes vercel with its credential block (the composition root enforces completeness)', () => {
    const result = parseEnv({
      ...localDev(),
      DOMAIN_PROVISIONER: 'vercel',
      VERCEL_TOKEN: 'token-value',
      VERCEL_PROJECT_ID: 'prj_123',
      VERCEL_TEAM_ID: 'team_42',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DOMAIN_PROVISIONER).toBe('vercel');
      expect(result.data.VERCEL_PROJECT_ID).toBe('prj_123');
    }
  });

  it('refuses an unknown provisioner', () => {
    expect(parseEnv({ ...localDev(), DOMAIN_PROVISIONER: 'cloudflare' }).success).toBe(false);
  });

  // The platform's own VERCEL flag says nothing about domain provisioning: it
  // carries no API token, so it must not select the vercel adapter.
  it('stays on noop on a Vercel deployment that set no provisioner', () => {
    const result = parseEnv(deployed());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.DOMAIN_PROVISIONER).toBe('noop');
  });
});

// The command-specific subsets (DECIDE F4): each entry point parses only the
// keys it needs, off the one shared config module, with the shared defaults.
describe('config subsets', () => {
  it('the database subset defaults the connection string and the driver', () => {
    const parsed = databaseEnvSchema.parse({});
    expect(parsed.DATABASE_URL).toBe(DEFAULT_DATABASE_URL);
    expect(parsed.DB_DRIVER).toBe('node-postgres');
  });

  it('the database subset takes an explicit driver', () => {
    expect(databaseEnvSchema.parse({ DB_DRIVER: 'neon-http' }).DB_DRIVER).toBe('neon-http');
  });

  it('the seed subset defaults the URL and the dev secret', () => {
    const parsed = seedEnvSchema.parse({});
    expect(parsed.DATABASE_URL).toBe(DEFAULT_DATABASE_URL);
    expect(parsed.BETTER_AUTH_SECRET).toBe(DEV_ONLY_SECRET);
  });

  it('the observability subset defaults the service name and leaves endpoints unset', () => {
    const parsed = observabilityEnvSchema.parse({});
    expect(parsed.OTEL_SERVICE_NAME).toBe('agentproofarch-server');
    expect(parsed.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(parsed.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
  });
});
