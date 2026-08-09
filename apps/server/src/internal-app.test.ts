import { describe, expect, it } from 'vitest';

import type { TenantDomain } from '#core/domain/index.js';
import type { TenantDomainRepository } from '#core/server/index.js';

import { buildInternalApp } from './internal-app.js';

const verified: TenantDomain = {
  id: 'd1',
  tenantId: 't1',
  domain: 'shop.acme.com',
  kind: 'custom',
  verified: true,
};

const deps = (findByDomain: TenantDomainRepository['findByDomain']) => ({
  tenantDomains: {
    findByDomain,
    listVerifiedDomains: async () => [],
  } satisfies TenantDomainRepository,
});

describe('internal domain-check endpoint', () => {
  it('answers 200 for a domain that exists and is verified', async () => {
    const app = buildInternalApp(deps(async (d) => (d === 'shop.acme.com' ? verified : null)));
    const res = await app.request('/internal/domain-check?domain=shop.acme.com');
    expect(res.status).toBe(200);
  });

  it('lowercases and trims the queried host before lookup', async () => {
    const seen: string[] = [];
    const app = buildInternalApp(
      deps(async (d) => {
        seen.push(d);
        return verified;
      }),
    );
    const res = await app.request('/internal/domain-check?domain=%20SHOP.ACME.com%20');
    expect(res.status).toBe(200);
    expect(seen).toEqual(['shop.acme.com']);
  });

  it('answers 404 for an unknown or unverified domain (repo returns null)', async () => {
    const app = buildInternalApp(deps(async () => null));
    const res = await app.request('/internal/domain-check?domain=ghost.example.com');
    expect(res.status).toBe(404);
  });

  it('answers 400 when the domain query is missing', async () => {
    const app = buildInternalApp(deps(async () => verified));
    const res = await app.request('/internal/domain-check');
    expect(res.status).toBe(400);
  });

  it('exposes no other route (the public API surface is a separate app)', async () => {
    const app = buildInternalApp(deps(async () => verified));
    expect((await app.request('/api/health')).status).toBe(404);
    expect((await app.request('/')).status).toBe(404);
  });
});
