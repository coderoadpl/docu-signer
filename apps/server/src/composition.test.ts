import { describe, expect, it, vi } from 'vitest';

import { serverEnvSchema } from '#core/server/config.js';

import { selectDomainPort, selectEmailPort, selectGoogleSettings } from './composition.js';
import type { Env } from './env.js';

// selectDomainPort only — never createDeps here: the full graph constructs a
// real Better Auth instance whose init eagerly queries tenant_domains, and the
// check runner has no database (CI-only unhandled rejection, 2026-07-21).
const env = (over: Partial<Env>): Env => ({
  ...serverEnvSchema.parse({}),
  APP_BASE_URL: 'http://localhost:47100',
  ...over,
});

describe('selectDomainPort', () => {
  it('wires the caddy DomainPort when DOMAIN_PROVISIONER=caddy', async () => {
    const port = selectDomainPort(env({ DOMAIN_PROVISIONER: 'caddy' }));
    // No target configured → the caddy port rejects without any DNS lookup,
    // which is enough to prove the caddy branch (not noop) was selected.
    const result = await port.check('shop.acme.com');
    expect(result.resolved).toBe(false);
    expect(result.detail).toContain('SELF_HOST_TARGET');
  });

  it('wires the noop DomainPort by default', async () => {
    const port = selectDomainPort(env({}));
    expect((await port.check('anything.test')).resolved).toBe(true);
  });

  it('wires the vercel DomainPort when DOMAIN_PROVISIONER=vercel and its block is set', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const port = selectDomainPort(
        env({
          DOMAIN_PROVISIONER: 'vercel',
          VERCEL_TOKEN: 'token-value',
          VERCEL_PROJECT_ID: 'prj_123',
          VERCEL_TEAM_ID: 'team_42',
        }),
      );
      expect((await port.check('shop.acme.com')).resolved).toBe(false);
      expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
        'https://api.vercel.com/v9/projects/prj_123/domains/shop.acme.com?teamId=team_42',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses to boot when DOMAIN_PROVISIONER=vercel is missing its credentials', () => {
    expect(() => selectDomainPort(env({ DOMAIN_PROVISIONER: 'vercel' }))).toThrow(/VERCEL_TOKEN/);
    expect(() =>
      selectDomainPort(env({ DOMAIN_PROVISIONER: 'vercel', VERCEL_TOKEN: 'token-value' })),
    ).toThrow(/VERCEL_PROJECT_ID/);
  });
});

describe('selectEmailPort', () => {
  it('wires the smtp transport by default (dev/CI point it at Mailpit, no auth required)', () => {
    const port = selectEmailPort(env({}));
    expect(typeof port.sendMail).toBe('function');
  });

  it('wires the smtp transport against an authenticated relay when creds are set', () => {
    const port = selectEmailPort(
      env({ EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    );
    expect(typeof port.sendMail).toBe('function');
  });

  it('wires the ses transport when the AWS block is set', () => {
    const port = selectEmailPort(
      env({
        EMAIL_TRANSPORT: 'ses',
        AWS_REGION: 'eu-central-1',
        AWS_ACCESS_KEY_ID: 'AKIA-test',
        AWS_SECRET_ACCESS_KEY: 'secret',
      }),
    );
    expect(typeof port.sendMail).toBe('function');
  });

  it('fails fast when EMAIL_TRANSPORT=ses is missing its AWS credentials', () => {
    expect(() => selectEmailPort(env({ EMAIL_TRANSPORT: 'ses' }))).toThrow(/AWS_REGION/);
  });
});

describe('selectGoogleSettings', () => {
  it('is undefined unless BOTH id and secret are present', () => {
    expect(selectGoogleSettings(env({}))).toBeUndefined();
    expect(selectGoogleSettings(env({ GOOGLE_CLIENT_ID: 'id' }))).toBeUndefined();
    expect(selectGoogleSettings(env({ GOOGLE_CLIENT_SECRET: 'secret' }))).toBeUndefined();
  });

  it('wires Google when both keys are present', () => {
    const google = selectGoogleSettings(env({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }));
    expect(google).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });
});
