import { describe, expect, it, vi } from 'vitest';

import type { TenantAccessReader } from './ports.js';
import { tenantCreationContext } from './context.js';

const user = {
  userId: 'u1',
  email: 'staff@example.com',
  name: 'Staff',
};

const tenantAccess = (
  memberships: Awaited<ReturnType<TenantAccessReader['listTenantsForStaff']>>,
): TenantAccessReader => ({
  listTenantsForStaff: async () => memberships,
  findStaffGrant: async () => null,
  findMember: async () => null,
});

describe('tenantCreationContext', () => {
  it('resolves instance staff for staff mode with owner precedence', async () => {
    const context = await tenantCreationContext(user, 'staff', {
      tenantAccess: tenantAccess([
        {
          tenant: { id: 't-admin', slug: 'admin-tenant', name: 'Admin tenant' },
          staffRole: 'admin',
        },
        {
          tenant: { id: 't-owner', slug: 'owner-tenant', name: 'Owner tenant' },
          staffRole: 'owner',
        },
      ]),
    });

    expect(context.identity).toMatchObject({
      userId: 'u1',
      tenantId: null,
      staffRole: 'owner',
      memberId: null,
    });
    expect(context.tenantCreationMode).toBe('staff');
  });

  it('keeps a caller without instance staff as visitor in staff mode', async () => {
    const context = await tenantCreationContext(user, 'staff', {
      tenantAccess: tenantAccess([]),
    });

    expect(context.identity.staffRole).toBeNull();
  });

  it('does not read staff grants when the mode cannot use them', async () => {
    const listTenantsForStaff = vi.fn<TenantAccessReader['listTenantsForStaff']>(async () => []);
    const reader: TenantAccessReader = {
      listTenantsForStaff,
      findStaffGrant: async () => null,
      findMember: async () => null,
    };

    await tenantCreationContext(user, 'open', { tenantAccess: reader });
    await tenantCreationContext(user, 'closed', { tenantAccess: reader });

    expect(listTenantsForStaff).not.toHaveBeenCalled();
  });
});
