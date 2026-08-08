import { describe, expect, it } from 'vitest';

import type { TenantDomain } from '#core/domain/index.js';
import type { BackfillPort, TenantDomainRepository } from '#core/server/index.js';

import { buildInternalApp, parseLimit } from './internal-app.js';

const verified: TenantDomain = {
  id: 'd1',
  tenantId: 't1',
  domain: 'shop.acme.com',
  kind: 'custom',
  verified: true,
};

const noopBackfills: BackfillPort = {
  loadCheckpoint: async () => null,
  saveCheckpoint: async () => {},
  normalizeMemberEmails: async () => ({ processed: 0, nextCursor: null, done: true }),
};

const deps = (
  findByDomain: TenantDomainRepository['findByDomain'],
  backfills: BackfillPort = noopBackfills,
) => ({
  tenantDomains: {
    findByDomain,
    listVerifiedDomains: async () => [],
    listByTenant: async () => [],
    findAnyByDomain: async () => null,
    findByTenantAndDomain: async () => null,
    add: async (input) => input,
    setVerified: async () => null,
    removeByTenantAndDomain: async () => 0,
  } satisfies TenantDomainRepository,
  backfills,
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

describe('internal backfill endpoint', () => {
  const trackingBackfills = (): BackfillPort => {
    let checkpoint: Awaited<ReturnType<BackfillPort['loadCheckpoint']>> = null;
    return {
      loadCheckpoint: async () => checkpoint,
      saveCheckpoint: async (next) => {
        checkpoint = next;
      },
      normalizeMemberEmails: async (_cursor, limit) => ({ processed: limit, nextCursor: 'z', done: true }),
    };
  };

  it('runs one batch of a registered backfill and reports progress', async () => {
    const app = buildInternalApp(deps(async () => verified, trackingBackfills()));
    const res = await app.request('/internal/backfills/members-email-normalize?limit=5', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: 'members-email-normalize', processed: 5, done: true });
  });

  it('answers 404 for an unregistered backfill name', async () => {
    const app = buildInternalApp(deps(async () => verified));
    const res = await app.request('/internal/backfills/no-such-backfill', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('parseLimit', () => {
  it('defaults to 100 and caps at 1000, flooring invalid input', () => {
    expect(parseLimit(undefined)).toBe(100);
    expect(parseLimit('0')).toBe(100);
    expect(parseLimit('-3')).toBe(100);
    expect(parseLimit('abc')).toBe(100);
    expect(parseLimit('50')).toBe(50);
    expect(parseLimit('99999')).toBe(1000);
  });
});
