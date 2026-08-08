import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  decide,
  grantsFor,
  PRINCIPALS,
  principalOf,
  type Capability,
  type Identity,
  type Principal,
  type StaffRole,
} from './index.js';

const asStaff = (staffRole: StaffRole): Identity => ({
  userId: 'u1',
  email: 'staff@example.com',
  name: 'Staff',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole,
  memberId: null,
});

const asMember: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  memberId: 'm-1',
};

const asVisitor: Identity = {
  userId: 'u3',
  email: 'visitor@example.com',
  name: 'Visitor',
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
};

const identityFor: Record<Principal, Identity> = {
  owner: asStaff('owner'),
  admin: asStaff('admin'),
  member: asMember,
  visitor: asVisitor,
};

// The policy table restated independently of the implementation's GRANTS map —
// Record<Capability, Record<Principal, boolean>> is exhaustive by construction,
// so a new capability or principal fails to compile until this table decides it.
// owner and admin are now DISTINCT principals: the staff:* rows are where they
// diverge (grant/revoke are owner-only), and are the reason the split exists.
const EXPECTED: Record<Capability, Record<Principal, boolean>> = {
  'todo:read': { owner: true, admin: true, member: true, visitor: false },
  'todo:write': { owner: true, admin: true, member: true, visitor: false },
  'card:read': { owner: true, admin: true, member: true, visitor: false },
  'card:write': { owner: true, admin: true, member: true, visitor: false },
  'member:read': { owner: true, admin: true, member: false, visitor: false },
  'member:write': { owner: true, admin: true, member: false, visitor: false },
  'member:remove': { owner: true, admin: true, member: false, visitor: false },
  'member:export': { owner: true, admin: true, member: false, visitor: false },
  'staff:read': { owner: true, admin: true, member: false, visitor: false },
  'staff:grant': { owner: true, admin: false, member: false, visitor: false },
  'staff:revoke': { owner: true, admin: false, member: false, visitor: false },
  'domain:read': { owner: true, admin: true, member: false, visitor: false },
  'domain:write': { owner: true, admin: false, member: false, visitor: false },
  'tenant:create': { owner: true, admin: true, member: false, visitor: true },
};

describe('principalOf', () => {
  it('reads an owner grant as the owner principal', () => {
    expect(principalOf(asStaff('owner'))).toBe('owner');
  });

  it('reads an admin grant as the admin principal (distinct from owner)', () => {
    expect(principalOf(asStaff('admin'))).toBe('admin');
  });

  it('reads a membership without a staff grant as member', () => {
    expect(principalOf(asMember)).toBe('member');
  });

  it('reads a tenant-less identity as visitor', () => {
    expect(principalOf(asVisitor)).toBe('visitor');
  });
});

describe('decide — exhaustive capability × principal matrix', () => {
  for (const capability of CAPABILITIES) {
    for (const principal of PRINCIPALS) {
      const expected = EXPECTED[capability][principal];
      it(`${principal} ${expected ? 'may' : 'may NOT'} ${capability}`, () => {
        expect(decide(identityFor[principal], capability, 'open').allowed).toBe(expected);
      });
    }
  }

  it('carries a reason on every denial and none on a grant', () => {
    const denied = decide(asVisitor, 'card:write', 'open');
    expect(denied).toEqual({ allowed: false, reason: 'card:write is not permitted for visitor' });
    expect(decide(asStaff('admin'), 'card:write', 'open')).toEqual({ allowed: true });
  });

  it('grants an owner every capability (owner is the superset principal)', () => {
    for (const capability of CAPABILITIES) {
      expect(decide(asStaff('owner'), capability, 'open').allowed).toBe(true);
    }
  });

  it('denies an admin exactly the owner-only staff-grant capabilities (FR-8 split)', () => {
    expect(decide(asStaff('admin'), 'staff:grant', 'open')).toEqual({
      allowed: false,
      reason: 'staff:grant is not permitted for admin',
    });
    expect(decide(asStaff('admin'), 'staff:revoke', 'open')).toEqual({
      allowed: false,
      reason: 'staff:revoke is not permitted for admin',
    });
    // Everything else an admin shares with an owner, including reading the roster.
    expect(decide(asStaff('admin'), 'staff:read', 'open').allowed).toBe(true);
  });
});

describe('tenant creation modes', () => {
  const cases = [
    ['open', { owner: true, admin: true, member: false, visitor: true }],
    ['staff', { owner: true, admin: true, member: false, visitor: false }],
    ['closed', { owner: false, admin: false, member: false, visitor: false }],
  ] as const;

  for (const [mode, expected] of cases) {
    it(`${mode} derives and enforces the tenant:create row`, () => {
      for (const principal of PRINCIPALS) {
        expect(grantsFor(mode)['tenant:create'].includes(principal)).toBe(expected[principal]);
        expect(decide(identityFor[principal], 'tenant:create', mode).allowed).toBe(
          expected[principal],
        );
      }
    });
  }

  it('leaves a non-varying capability unchanged across modes', () => {
    for (const mode of ['open', 'staff', 'closed'] as const) {
      expect(grantsFor(mode)['todo:write']).toEqual(['owner', 'admin', 'member']);
      expect(decide(asMember, 'todo:write', mode)).toEqual({ allowed: true });
      expect(decide(asVisitor, 'todo:write', mode)).toEqual({
        allowed: false,
        reason: 'todo:write is not permitted for visitor',
      });
    }
  });
});
