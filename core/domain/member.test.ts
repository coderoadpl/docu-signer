import { describe, expect, it } from 'vitest';

import {
  memberEmailSchema,
  memberSchema,
  memberUpdateSchema,
  newMemberSchema,
} from './member.js';

describe('memberSchema', () => {
  const valid = {
    id: 'm1',
    tenantId: 't1',
    userId: 'u1',
    email: 'a@b.com',
    displayName: 'Ada',
    tags: ['vip'],
    marketingConsents: [{ channel: 'email', granted: true, updatedAt: '2026-07-03T00:00:00.000Z' }],
    externalCustomerIds: ['cus_123'],
    createdAt: '2026-07-03T00:00:00.000Z',
    lastSeenAt: null,
  };

  it('parses a full member', () => {
    expect(memberSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a null userId (provisioned without an auth account yet)', () => {
    expect(memberSchema.parse({ ...valid, userId: null }).userId).toBeNull();
  });

  it('rejects an unknown consent channel', () => {
    const invalid = { ...valid, marketingConsents: [{ channel: 'fax', granted: true, updatedAt: 'x' }] };
    expect(memberSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('memberEmailSchema', () => {
  it('lowercases and trims before validating', () => {
    expect(memberEmailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('rejects a non-email', () => {
    expect(memberEmailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('newMemberSchema', () => {
  it('requires only an email', () => {
    expect(newMemberSchema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
  });

  it('rejects a blank tag', () => {
    expect(newMemberSchema.safeParse({ email: 'a@b.com', tags: [' '] }).success).toBe(false);
  });
});

describe('memberUpdateSchema', () => {
  it('accepts a null displayName to clear it', () => {
    expect(memberUpdateSchema.parse({ id: 'm1', displayName: null }).displayName).toBeNull();
  });

  it('requires an id', () => {
    expect(memberUpdateSchema.safeParse({ tags: [] }).success).toBe(false);
  });
});
