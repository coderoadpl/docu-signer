import { describe, expect, it } from 'vitest';

import { staffRoleSchema } from './identity.js';

describe('staffRoleSchema', () => {
  it('accepts the known roles', () => {
    expect(staffRoleSchema.parse('owner')).toBe('owner');
    expect(staffRoleSchema.parse('admin')).toBe('admin');
  });

  it('rejects an unknown role', () => {
    expect(staffRoleSchema.safeParse('member').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(staffRoleSchema.safeParse(1).success).toBe(false);
  });
});
