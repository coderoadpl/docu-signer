import { describe, expect, it } from 'vitest';

import type { Identity, Member } from '#core/domain/index.js';

import type { MemberRepository } from '../ports.js';
import {
  ensureMember,
  exportMember,
  listMembers,
  removeMember,
  updateMember,
  type MemberDeps,
} from './members.js';

const staff = (tenantId: string | null): Identity => ({
  userId: 'u1',
  email: 'staff@example.com',
  name: 'Staff',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
});

const member: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  memberId: 'm-1',
};

const seedMember = (over: Partial<Member> = {}): Member => ({
  id: 'm-seed',
  tenantId: 't-acme',
  userId: null,
  email: 'seed@example.com',
  displayName: 'Seed',
  tags: [],
  marketingConsents: [],
  externalCustomerIds: [],
  createdAt: '2026-07-03T00:00:00.000Z',
  lastSeenAt: null,
  ...over,
});

const fakeRepo = (initial: Member[] = []) => {
  let store = [...initial];
  const repo: MemberRepository = {
    listByTenant: async (tenantId) => store.filter((row) => row.tenantId === tenantId),
    findByEmail: async (tenantId, email) =>
      store.find((row) => row.tenantId === tenantId && row.email === email) ?? null,
    findByTenantAndId: async (tenantId, id) =>
      store.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
    create: async (row) => {
      store.push(row);
    },
    update: async (row) => {
      store = store.map((existing) => (existing.id === row.id ? row : existing));
    },
    deleteByTenantAndId: async (tenantId, id) => {
      const before = store.length;
      store = store.filter((row) => !(row.tenantId === tenantId && row.id === id));
      return before - store.length;
    },
  };
  return { repo, store: () => store };
};

const deps = (repo: MemberRepository): MemberDeps => ({
  members: repo,
  ids: { nextId: () => 'member-1' },
  clock: { nowIso: () => '2026-07-10T00:00:00.000Z' },
});

describe('member use-cases — authorization', () => {
  it('denies a tenant-less staff caller with forbidden before any repository access', async () => {
    const { repo, store } = fakeRepo();
    const listed = await listMembers({ identity: staff(null), tenantCreationMode: 'open' }, deps(repo));
    expect(listed).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const ensured = await ensureMember({ identity: staff(null), tenantCreationMode: 'open' }, { email: 'a@b.com' }, deps(repo));
    expect(ensured).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store()).toHaveLength(0);
  });

  it('denies an end-customer member (members are staff-managed, not roster editors)', async () => {
    const { repo } = fakeRepo([seedMember()]);
    expect(await listMembers({ identity: member, tenantCreationMode: 'open' }, deps(repo))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(
      await ensureMember({ identity: member, tenantCreationMode: 'open' }, { email: 'a@b.com' }, deps(repo)),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await removeMember({ identity: member, tenantCreationMode: 'open' }, { id: 'm-seed' }, deps(repo))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await exportMember({ identity: member, tenantCreationMode: 'open' }, { id: 'm-seed' }, deps(repo))).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});

describe('ensureMember — idempotent find-or-create by (tenant, email)', () => {
  it('creates a member row with null userId and normalized fields on first call', async () => {
    const { repo, store } = fakeRepo();
    const result = await ensureMember(
      { identity: staff('t-acme'), tenantCreationMode: 'open' },
      { email: 'New@Example.com', displayName: 'New', marketingConsents: [{ channel: 'email', granted: true }] },
      deps(repo),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        created: true,
        member: {
          tenantId: 't-acme',
          userId: null,
          email: 'new@example.com',
          displayName: 'New',
          marketingConsents: [{ channel: 'email', granted: true, updatedAt: '2026-07-10T00:00:00.000Z' }],
        },
      },
    });
    expect(store()).toHaveLength(1);
  });

  it('returns the existing member unchanged on a repeat call (created: false)', async () => {
    const { repo, store } = fakeRepo([seedMember({ id: 'm-seed', email: 'seed@example.com', tags: ['vip'] })]);
    const result = await ensureMember(
      { identity: staff('t-acme'), tenantCreationMode: 'open' },
      { email: 'seed@example.com', tags: [] },
      deps(repo),
    );
    expect(result).toMatchObject({ ok: true, value: { created: false, member: { id: 'm-seed', tags: ['vip'] } } });
    expect(store()).toHaveLength(1);
  });

  it("rejects a non-email with 'validation' before touching the repository", async () => {
    const { repo, store } = fakeRepo();
    const result = await ensureMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { email: 'nope' }, deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(store()).toHaveLength(0);
  });
});

describe('updateMember', () => {
  it('sets displayName, tags and re-stamps consents', async () => {
    const { repo } = fakeRepo([seedMember({ id: 'm-seed', displayName: 'Old', tags: ['a'] })]);
    const result = await updateMember(
      { identity: staff('t-acme'), tenantCreationMode: 'open' },
      { id: 'm-seed', displayName: 'New', tags: ['b'], marketingConsents: [{ channel: 'sms', granted: false }] },
      deps(repo),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        displayName: 'New',
        tags: ['b'],
        marketingConsents: [{ channel: 'sms', granted: false, updatedAt: '2026-07-10T00:00:00.000Z' }],
      },
    });
  });

  it('clears displayName when passed null but leaves omitted fields intact', async () => {
    const { repo } = fakeRepo([seedMember({ id: 'm-seed', displayName: 'Old', tags: ['keep'] })]);
    const result = await updateMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'm-seed', displayName: null }, deps(repo));
    expect(result).toMatchObject({ ok: true, value: { displayName: null, tags: ['keep'] } });
  });

  it("returns not_found for an id outside the caller's tenant", async () => {
    const { repo } = fakeRepo([seedMember({ id: 'm-other', tenantId: 't-globex' })]);
    const result = await updateMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'm-other', tags: [] }, deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('removeMember', () => {
  it('deletes the member row and reports the cascade count', async () => {
    const { repo, store } = fakeRepo([seedMember({ id: 'm-seed' })]);
    const result = await removeMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'm-seed' }, deps(repo));
    expect(result).toMatchObject({ ok: true, value: { memberId: 'm-seed', deleted: { members: 1 } } });
    expect(store()).toHaveLength(0);
  });

  it('cannot remove a member of another tenant (tenant-scoped not_found)', async () => {
    const { repo, store } = fakeRepo([seedMember({ id: 'm-other', tenantId: 't-globex' })]);
    const result = await removeMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'm-other' }, deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(store()).toHaveLength(1);
  });
});

describe('exportMember', () => {
  it('dumps the member incl. its own email snapshot with export metadata', async () => {
    const { repo } = fakeRepo([seedMember({ id: 'm-seed', email: 'dump@example.com' })]);
    const result = await exportMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'm-seed' }, deps(repo));
    expect(result).toMatchObject({
      ok: true,
      value: {
        exportedAt: '2026-07-10T00:00:00.000Z',
        tenantId: 't-acme',
        member: { id: 'm-seed', email: 'dump@example.com' },
      },
    });
  });

  it('returns not_found for an unknown member', async () => {
    const { repo } = fakeRepo();
    const result = await exportMember({ identity: staff('t-acme'), tenantCreationMode: 'open' }, { id: 'ghost' }, deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
