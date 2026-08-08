import { describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import {
  looseEnvelopeSchema,
  publicTenantDiscoveryPath,
  publicTenantProfilePath,
} from '#core/contract/index.js';
import { tenantContentVersion, type Tenant } from '#core/domain/index.js';

import { buildApp } from './app.js';
import type { AppDeps } from './composition.js';

// A real Better Auth instance satisfies AppDeps.auth without a cast; its lazy pg
// pool opens no connection and no test here hits an auth route.
const auth = createAuth(
  createDb('node-postgres', 'postgresql://user:pass@localhost:5432/agentproofarch_test'),
  {
    secret: 'test-secret-value-that-is-at-least-32-chars',
    baseUrl: 'http://localhost',
    baseDomain: 'localhost',
    rateLimitEnabled: false,
    trustedOrigins: [],
    secureCookies: false,
    email: { sendMail: async () => {} },
  },
);

const acme: Tenant = { id: 'tenant-acme', slug: 'acme', name: 'Acme Inc' };
const acmeVersion = tenantContentVersion(acme);

const depsWith = (findBySlug: AppDeps['tenants']['findBySlug']): AppDeps => ({
  auth,
  authPort: { getAuthenticatedUser: async () => null },
  email: { sendMail: async () => {} },
  googleEnabled: false,
  todos: { listByTenant: async () => [], create: async () => {} },
  cards: { listByTenant: async () => [], create: async () => {}, updatePositions: async () => {} },
  members: {
    listByTenant: async () => [],
    findByEmail: async () => null,
    findByTenantAndId: async () => null,
    create: async () => {},
    update: async () => {},
    deleteByTenantAndId: async () => 0,
  },
  staff: {
    listByTenant: async () => [],
    findGrant: async () => null,
    grant: async () => {},
    revokeLastOwnerSafe: async () => 0,
  },
  users: { findByEmail: async () => null },
  tenantDomains: {
    findByDomain: async () => null,
    listVerifiedDomains: async () => [],
    listByTenant: async () => [],
    findAnyByDomain: async () => null,
    findByTenantAndDomain: async () => null,
    add: async (input) => input,
    setVerified: async () => null,
    removeByTenantAndDomain: async () => 0,
  },
  domainTarget: { cname: null, ip: null },
  domainPort: {
    provision: async () => {},
    remove: async () => {},
    check: async () => ({ resolved: true, detail: 'noop' }),
  },
  tenants: {
    findById: async () => null,
    findBySlug,
    createTenantWithOwner: async () => {
      throw new Error('not implemented in fake');
    },
    deleteTenant: async () => {},
  },
  tenantAccess: {
    listTenantsForStaff: async () => [],
    findStaffGrant: async () => null,
    findMember: async () => null,
  },
  health: { pingDatabase: async () => true },
  backfills: {
    loadCheckpoint: async () => null,
    saveCheckpoint: async () => {},
    normalizeMemberEmails: async () => ({ processed: 0, nextCursor: null, done: true }),
  },
  backfillSecret: null,
  ids: { nextId: () => 'test-id' },
  clock: { nowIso: () => '2026-07-15T00:00:00.000Z' },
  baseDomain: 'localhost',
  tenantCreationMode: 'open',
  commitSha: 'test-sha',
});

const knownTenant = () => depsWith(async (slug) => (slug === 'acme' ? acme : null));

describe('public tenant profile group', () => {
  it('serves the versioned profile unauthenticated with the public cache header', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantProfilePath('acme', acmeVersion), {
      headers: { origin: 'https://someone-elses-site.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    );
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body).toEqual({
      ok: true,
      data: { slug: 'acme', displayName: 'Acme Inc', contentVersion: acmeVersion },
    });
  });

  it('exposes no unsafe field (id, email, members) in the public body', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantProfilePath('acme', acmeVersion));
    const raw = await res.text();
    expect(raw).not.toContain('tenant-acme');
    expect(raw).not.toContain('email');
  });

  it('answers the discovery route with slug + version under a short cache', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantDiscoveryPath('acme'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=30, stale-while-revalidate=30',
    );
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body).toEqual({ ok: true, data: { slug: 'acme', contentVersion: acmeVersion } });
  });

  it('returns a non-cached not_found envelope for an unknown tenant', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantProfilePath('ghost', acmeVersion));
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.error.code).toBe('not_found');
      expect(body.error.message).not.toContain('ghost');
    }
  });

  it('rejects a malformed version key with a validation envelope (uncacheable)', async () => {
    const res = await buildApp(knownTenant()).request('/api/public/tenants/acme/v/BAD_KEY');
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a malformed slug on both public routes (uncacheable validation)', async () => {
    for (const path of ['/api/public/tenants/ab', `/api/public/tenants/ab/v/${acmeVersion}`]) {
      const res = await buildApp(knownTenant()).request(path);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('opens CORS on the public group (GET origin echoed as *)', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantProfilePath('acme', acmeVersion), {
      headers: { origin: 'https://foreign.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers a CORS preflight (OPTIONS) on the public group', async () => {
    const res = await buildApp(knownTenant()).request(publicTenantProfilePath('acme', acmeVersion), {
      method: 'OPTIONS',
      headers: {
        origin: 'https://foreign.example',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('is shareable across hosts: same URL works on the apex and a tenant subdomain', async () => {
    for (const host of ['localhost', 'acme.localhost', 'shop.acme.com']) {
      const res = await buildApp(knownTenant()).request(
        publicTenantProfilePath('acme', acmeVersion),
        { headers: { host } },
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('the authenticated surface stays closed', () => {
  it('keeps /api/health CORS-closed and no-store even with a foreign Origin', async () => {
    const res = await buildApp(knownTenant()).request('/api/health', {
      headers: { origin: 'https://foreign.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not open CORS on an authenticated /api/* route', async () => {
    const res = await buildApp(knownTenant()).request('/api/me', {
      headers: { origin: 'https://foreign.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
