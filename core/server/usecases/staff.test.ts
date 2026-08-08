import { describe, expect, it } from 'vitest';

import type { Identity, StaffRole } from '#core/domain/index.js';

import type { DirectoryUser, StaffRepository, UserDirectory } from '../ports.js';
import { grantAdmin, listStaff, revokeAdmin, type StaffDeps } from './staff.js';

const identity = (over: Partial<Identity> = {}): Identity => ({
  userId: 'u-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: 'owner',
  memberId: null,
  ...over,
});

const owner = identity();
const admin = identity({ userId: 'u-admin', email: 'admin@example.com', name: 'Admin', staffRole: 'admin' });
const member = identity({ userId: 'u-cust', staffRole: null, memberId: 'm-1' });
const visitor = identity({
  userId: 'u-visitor',
  staffRole: null,
  memberId: null,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
});

interface GrantRow {
  id: string;
  tenantId: string;
  userId: string;
  role: StaffRole;
}

const fakes = (grants: GrantRow[] = [], directory: DirectoryUser[] = []) => {
  let store = [...grants];
  const staff: StaffRepository = {
    listByTenant: async (tenantId) =>
      store
        .filter((row) => row.tenantId === tenantId)
        .map((row) => {
          const user = directory.find((entry) => entry.userId === row.userId);
          return {
            id: row.id,
            userId: row.userId,
            email: user?.email ?? `${row.userId}@example.com`,
            name: user?.name ?? row.userId,
            role: row.role,
          };
        }),
    findGrant: async (tenantId, userId) => {
      const row = store.find((entry) => entry.tenantId === tenantId && entry.userId === userId);
      return row ? { id: row.id, userId: row.userId, role: row.role } : null;
    },
    grant: async (input) => {
      store.push(input);
    },
    revokeLastOwnerSafe: async (tenantId, userId) => {
      const target = store.find((row) => row.tenantId === tenantId && row.userId === userId);
      if (!target) return 0;
      const owners = store.filter((row) => row.tenantId === tenantId && row.role === 'owner').length;
      // Mirror the atomic conditional delete: an owner is refused when it is the
      // last one; any non-owner grant is always removable.
      if (target.role === 'owner' && owners <= 1) return 0;
      const before = store.length;
      store = store.filter((row) => !(row.tenantId === tenantId && row.userId === userId));
      return before - store.length;
    },
  };
  const users: UserDirectory = {
    findByEmail: async (email) => directory.find((entry) => entry.email === email) ?? null,
  };
  return { staff, users, store: () => store };
};

const deps = (staff: StaffRepository, users: UserDirectory): StaffDeps => ({
  staff,
  users,
  ids: { nextId: () => 'grant-new' },
});

const ownerGrant = (over: Partial<GrantRow> = {}): GrantRow => ({
  id: 'grant-owner',
  tenantId: 't-acme',
  userId: 'u-owner',
  role: 'owner',
  ...over,
});

const carlos: DirectoryUser = { userId: 'u-carlos', email: 'carlos@example.com', name: 'Carlos' };

describe('staff use-cases — authorization matrix', () => {
  it('listStaff is readable by owner AND admin, forbidden to member and tenant-less visitor', async () => {
    const { staff, users } = fakes([ownerGrant()]);
    expect((await listStaff({ identity: owner, tenantCreationMode: 'open' }, deps(staff, users))).ok).toBe(true);
    expect((await listStaff({ identity: admin, tenantCreationMode: 'open' }, deps(staff, users))).ok).toBe(true);
    expect(await listStaff({ identity: member, tenantCreationMode: 'open' }, deps(staff, users))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await listStaff({ identity: visitor, tenantCreationMode: 'open' }, deps(staff, users))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('grantAdmin is owner-only: an admin is forbidden before any lookup', async () => {
    const { staff, users, store } = fakes([ownerGrant()], [carlos]);
    const result = await grantAdmin({ identity: admin, tenantCreationMode: 'open' }, { email: carlos.email }, deps(staff, users));
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store()).toHaveLength(1);
  });

  it('revokeAdmin is owner-only: an admin is forbidden', async () => {
    const { staff, users } = fakes([ownerGrant(), { id: 'g2', tenantId: 't-acme', userId: 'u-carlos', role: 'admin' }], [carlos]);
    expect(await revokeAdmin({ identity: admin, tenantCreationMode: 'open' }, { userId: 'u-carlos' }, deps(staff, users))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('grantAdmin — existing-account requirement and idempotency', () => {
  it('grants admin to an existing account and reports granted: true', async () => {
    const { staff, users, store } = fakes([ownerGrant()], [carlos]);
    const result = await grantAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: carlos.email }, deps(staff, users));
    expect(result).toMatchObject({
      ok: true,
      value: { granted: true, staff: { userId: 'u-carlos', email: carlos.email, role: 'admin' } },
    });
    expect(store()).toHaveLength(2);
  });

  it('normalizes the email before the directory lookup', async () => {
    const { staff, users } = fakes([ownerGrant()], [carlos]);
    const result = await grantAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: '  Carlos@Example.com ' }, deps(staff, users));
    expect(result).toMatchObject({ ok: true, value: { granted: true, staff: { userId: 'u-carlos' } } });
  });

  it('returns not_found when the email has no account (FR-8: no invitations)', async () => {
    const { staff, users, store } = fakes([ownerGrant()], []);
    const result = await grantAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: 'ghost@example.com' }, deps(staff, users));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(store()).toHaveLength(1);
  });

  it('is idempotent: re-granting an existing staff member returns it unchanged (granted: false)', async () => {
    const { staff, users, store } = fakes(
      [ownerGrant(), { id: 'g-carlos', tenantId: 't-acme', userId: 'u-carlos', role: 'admin' }],
      [carlos],
    );
    const result = await grantAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: carlos.email }, deps(staff, users));
    expect(result).toMatchObject({
      ok: true,
      value: { granted: false, staff: { id: 'g-carlos', role: 'admin' } },
    });
    expect(store()).toHaveLength(2);
  });

  it('never downgrades an existing owner on a re-grant (idempotent, keeps owner)', async () => {
    const { staff, users } = fakes([ownerGrant({ userId: 'u-carlos', id: 'g-carlos' })], [carlos]);
    const result = await grantAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: carlos.email }, deps(staff, users));
    expect(result).toMatchObject({ ok: true, value: { granted: false, staff: { role: 'owner' } } });
  });
});

describe('revokeAdmin — last-owner lockout protection', () => {
  it('revokes an admin grant by userId and reports the removal', async () => {
    const { staff, users, store } = fakes(
      [ownerGrant(), { id: 'g-carlos', tenantId: 't-acme', userId: 'u-carlos', role: 'admin' }],
      [carlos],
    );
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { userId: 'u-carlos' }, deps(staff, users));
    expect(result).toMatchObject({ ok: true, value: { userId: 'u-carlos', revoked: 1 } });
    expect(store()).toHaveLength(1);
  });

  it('revokes by email (resolving the account through the directory)', async () => {
    const { staff, users } = fakes(
      [ownerGrant(), { id: 'g-carlos', tenantId: 't-acme', userId: 'u-carlos', role: 'admin' }],
      [carlos],
    );
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: carlos.email }, deps(staff, users));
    expect(result).toMatchObject({ ok: true, value: { userId: 'u-carlos', revoked: 1 } });
  });

  it('refuses to revoke the last owner (lockout guard) with a validation error', async () => {
    const { staff, users, store } = fakes([ownerGrant()], []);
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { userId: 'u-owner' }, deps(staff, users));
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store()).toHaveLength(1);
  });

  it('allows revoking one owner when a second owner remains', async () => {
    const { staff, users, store } = fakes(
      [ownerGrant(), ownerGrant({ id: 'g-carlos', userId: 'u-carlos' })],
      [carlos],
    );
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { userId: 'u-carlos' }, deps(staff, users));
    expect(result).toMatchObject({ ok: true, value: { revoked: 1 } });
    expect(store()).toHaveLength(1);
  });

  it('returns not_found when there is no grant for the target in this tenant', async () => {
    const { staff, users } = fakes([ownerGrant()], [carlos]);
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { userId: 'u-carlos' }, deps(staff, users));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('returns not_found when revoking an email with no account', async () => {
    const { staff, users } = fakes([ownerGrant()], []);
    const result = await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, { email: 'ghost@example.com' }, deps(staff, users));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('rejects a reference naming neither userId nor email with validation', async () => {
    const { staff, users } = fakes([ownerGrant()], []);
    expect(await revokeAdmin({ identity: owner, tenantCreationMode: 'open' }, {}, deps(staff, users))).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});
