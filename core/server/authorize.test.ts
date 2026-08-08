import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { authorize, authorizeTenant } from './authorize.js';

const staff: Identity = {
  userId: 'u1',
  email: 'staff@example.com',
  name: 'Staff',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: 'owner',
  memberId: null,
};

const member: Identity = { ...staff, staffRole: null, memberId: 'm-1' };

const visitor: Identity = {
  ...staff,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
};

describe('authorize', () => {
  it('passes (null) when the principal holds the capability', () => {
    expect(authorize({ identity: staff, tenantCreationMode: 'open' }, 'todo:write')).toBeNull();
  });

  it('returns a forbidden error carrying the deny reason', () => {
    expect(authorize({ identity: member, tenantCreationMode: 'open' }, 'tenant:create')).toEqual({
      code: 'forbidden',
      message: 'tenant:create is not permitted for member',
    });
  });
});

describe('authorizeTenant', () => {
  it('returns the resolved tenantId for a permitted, tenant-bound principal', () => {
    expect(authorizeTenant({ identity: staff, tenantCreationMode: 'open' }, 'card:read')).toEqual({ ok: true, value: 't-acme' });
    expect(authorizeTenant({ identity: member, tenantCreationMode: 'open' }, 'card:read')).toEqual({ ok: true, value: 't-acme' });
  });

  it('denies the tenant-less visitor with forbidden, before any tenant lookup', () => {
    expect(authorizeTenant({ identity: visitor, tenantCreationMode: 'open' }, 'todo:read')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('refuses a role carried without a resolved tenant (defensive tenant_not_found)', () => {
    const rootlessStaff: Identity = { ...staff, tenantId: null };
    expect(authorizeTenant({ identity: rootlessStaff, tenantCreationMode: 'open' }, 'todo:read')).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });
});
