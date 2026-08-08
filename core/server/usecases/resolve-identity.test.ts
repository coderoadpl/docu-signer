import { describe, expect, it } from 'vitest';

import type { Member, Membership, Tenant } from '#core/domain/index.js';

import type { TenantAccessReader, TenantRepository } from '../ports.js';
import { resolveIdentity } from './resolve-identity.js';

const user = { userId: 'u1', email: 'demo@example.com', name: 'Demo' };
const defaultTenant = { id: 'tenant-default', slug: 'default', name: 'Default' };

const deps = (tenant: Tenant | null, membership: Membership | null = null, member: Member | null = null) => {
  const tenants: TenantRepository = {
    findById: async (tenantId) => (tenant?.id === tenantId ? tenant : null),
    findBySlug: async (slug) => (tenant?.slug === slug ? tenant : null),
    createTenant: async (input) => ({ id: input.id, slug: input.slug, name: input.name }),
    createOwnerGrant: async () => undefined,
  };
  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => (membership ? [membership] : []),
    findStaffGrant: async () => membership,
    findMember: async () => member,
  };
  return { tenants, tenantAccess };
};

describe('resolveIdentity', () => {
  it('rejects anonymous requests', async () => {
    const result = await resolveIdentity(null, { host: 'anything', tenantHeader: 'ignored' }, deps(defaultTenant));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('always resolves the default tenant regardless of request selectors', async () => {
    const membership: Membership = { tenant: defaultTenant, staffRole: 'owner' };
    const first = await resolveIdentity(user, { host: 'other.example', tenantHeader: 'other' }, deps(defaultTenant, membership));
    const second = await resolveIdentity(user, { host: '', tenantHeader: null }, deps(defaultTenant, membership));
    expect(first).toMatchObject({ ok: true, value: { tenantId: 'tenant-default', tenantSlug: 'default', staffRole: 'owner' } });
    expect(second).toEqual(first);
  });

  it('rejects an authenticated user who is not provisioned on the default tenant', async () => {
    const result = await resolveIdentity(user, { host: 'localhost', tenantHeader: null }, deps(defaultTenant));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('resolves a member without a staff grant', async () => {
    const member: Member = {
      id: 'member-1',
      tenantId: defaultTenant.id,
      userId: user.userId,
      email: user.email,
      displayName: user.name,
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    const result = await resolveIdentity(
      user,
      { host: 'localhost', tenantHeader: null },
      deps(defaultTenant, null, member),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 'tenant-default', staffRole: null, memberId: 'member-1' },
    });
  });

  it('returns tenant_not_found when the default tenant seed is missing', async () => {
    const result = await resolveIdentity(user, { host: 'localhost', tenantHeader: null }, deps(null));
    expect(result).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
