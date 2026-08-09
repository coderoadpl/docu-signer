import { describe, expect, it } from 'vitest';

import type {
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { resolveIdentity } from './resolve-identity.js';

const tenant = { id: 'tenant-default', slug: 'default', name: 'Archive' };
const domains: TenantDomainRepository = {
  findByDomain: async (domain) =>
    domain === 'archive.example.com'
      ? {
          id: 'domain-1',
          tenantId: tenant.id,
          domain,
          kind: 'custom',
          verified: true,
        }
      : null,
  listVerifiedDomains: async () => [],
};
const tenants: TenantRepository = {
  findById: async (id) => (id === tenant.id ? tenant : null),
  findBySlug: async (slug) => (slug === tenant.slug ? tenant : null),
};
const user = { userId: 'u1', email: 'user@example.com', name: 'User' };

const access = (allowed: boolean): TenantAccessReader => ({
  findStaffGrant: async () => (allowed ? { staffRole: 'owner' } : null),
});

describe('resolveIdentity', () => {
  it('requires authentication', async () => {
    expect(
      await resolveIdentity(
        null,
        { host: 'archive.example.com', tenantHeader: null },
        { tenantDomains: domains, tenants, tenantAccess: access(true), baseDomain: 'example.com' },
      ),
    ).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('resolves a verified host binding and trusted grant', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'archive.example.com', tenantHeader: null },
      { tenantDomains: domains, tenants, tenantAccess: access(true), baseDomain: 'example.com' },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: tenant.id, staffRole: 'owner' },
    });
  });

  it('supports CLI tenant scoping internally and denies missing grants', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:47100', tenantHeader: 'default' },
      { tenantDomains: domains, tenants, tenantAccess: access(false), baseDomain: 'localhost' },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('returns a tenantless identity on the bare base domain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:47100', tenantHeader: null },
      { tenantDomains: domains, tenants, tenantAccess: access(true), baseDomain: 'localhost' },
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: null, staffRole: null },
    });
  });
});
