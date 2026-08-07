import { describe, expect, it } from 'vitest';

import type { Identity, Member, Membership } from '#core/domain/index.js';

import type { TenantAccessReader } from '../ports.js';
import { listMyTenants } from './tenants.js';

const identity: Identity = {
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
};

const acme: Membership = {
  tenant: { id: 't-acme', slug: 'acme', name: 'Acme Inc' },
  staffRole: 'owner',
};

const globex: Membership = {
  tenant: { id: 't-globex', slug: 'globex', name: 'Globex' },
  staffRole: 'admin',
};

const fakeTenantAccess = (byUser: Record<string, Membership[]>): TenantAccessReader => ({
  listTenantsForStaff: async (userId) => byUser[userId] ?? [],
  findStaffGrant: async () => null,
  findMember: async (): Promise<Member | null> => null,
});

describe('listMyTenants', () => {
  it('returns the staff memberships for the caller', async () => {
    const deps = { tenantAccess: fakeTenantAccess({ u1: [acme, globex] }) };

    const result = await listMyTenants({ identity }, deps);

    expect(result).toEqual({ ok: true, value: [acme, globex] });
  });

  it('returns an empty list when the caller has no staff grants', async () => {
    const deps = { tenantAccess: fakeTenantAccess({}) };

    const result = await listMyTenants({ identity }, deps);

    expect(result).toEqual({ ok: true, value: [] });
  });

  it('enumerates only the calling user, not others', async () => {
    const deps = { tenantAccess: fakeTenantAccess({ other: [acme] }) };

    const result = await listMyTenants({ identity }, deps);

    expect(result).toEqual({ ok: true, value: [] });
  });
});
