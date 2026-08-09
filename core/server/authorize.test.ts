import { describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { authorize, authorizeTenant } from './authorize.js';

const owner: Identity = {
  userId: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'tenant-default',
  tenantSlug: 'default',
  tenantName: 'Archive',
  staffRole: 'owner',
  apiToken: null,
};

describe('authorizeTenant', () => {
  it('returns the resolved tenant for a trusted account', () => {
    expect(authorize({ identity: owner }, 'document:write')).toBeNull();
    expect(authorizeTenant({ identity: owner }, 'document:read')).toEqual({
      ok: true,
      value: 'tenant-default',
    });
  });

  it('denies an account without a grant', () => {
    const visitor: Identity = {
      ...owner,
      tenantId: null,
      tenantSlug: null,
      tenantName: null,
      staffRole: null,
    };
    expect(authorizeTenant({ identity: visitor }, 'document:read')).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('refuses a role without a resolved tenant', () => {
    expect(
      authorizeTenant({ identity: { ...owner, tenantId: null } }, 'document:read'),
    ).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });
});
