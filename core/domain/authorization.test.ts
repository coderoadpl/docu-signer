import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  decide,
  principalOf,
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
});
