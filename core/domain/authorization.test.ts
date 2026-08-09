import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  decide,
  principalOf,
  type ApiTokenScope,
  type Identity,
  type StaffRole,
} from './index.js';

const identity = (staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'user@example.com',
  name: 'User',
  tenantId: staffRole ? 'tenant-default' : null,
  tenantSlug: staffRole ? 'default' : null,
  tenantName: staffRole ? 'Archive' : null,
  staffRole,
  apiToken: null,
});

describe('document authorization', () => {
  it('recognizes trusted owner and admin grants', () => {
    expect(principalOf(identity('owner'))).toBe('owner');
    expect(principalOf(identity('admin'))).toBe('admin');
    expect(principalOf(identity(null))).toBe('visitor');
  });

  it('grants every document capability to both trusted roles', () => {
    for (const capability of CAPABILITIES) {
      expect(decide(identity('owner'), capability)).toEqual({ allowed: true });
      expect(decide(identity('admin'), capability)).toEqual({ allowed: true });
    }
  });

  it('denies an identity without an archive grant', () => {
    expect(decide(identity(null), 'document:read')).toEqual({
      allowed: false,
      reason: 'document:read is not permitted for visitor',
    });
  });

  it('intersects API token scopes with trusted account grants', () => {
    const scoped = (scopes: readonly ApiTokenScope[]): Identity => ({
      ...identity('owner'),
      apiToken: { id: '11111111-1111-4111-8111-111111111111', scopes },
    });
    expect(decide(scoped(['read']), 'document:read')).toEqual({ allowed: true });
    expect(decide(scoped(['read']), 'document:write')).toMatchObject({ allowed: false });
    expect(decide(scoped(['write']), 'document:write')).toEqual({ allowed: true });
    expect(decide(scoped(['write:draft']), 'document:write')).toEqual({ allowed: true });
    expect(decide(scoped(['write:draft']), 'document:read')).toMatchObject({ allowed: false });
    expect(decide(scoped(['write']), 'document:approve')).toMatchObject({ allowed: false });
    expect(decide(scoped(['read']), 'api-token:manage')).toMatchObject({ allowed: false });
    expect(decide(scoped(['read']), 'saved-search:manage')).toMatchObject({ allowed: false });
  });
});
