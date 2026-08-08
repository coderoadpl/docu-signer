import { describe, expect, it } from 'vitest';

import type { Identity, __SINGULAR_PASCAL__ } from '#core/domain/index.js';

import type { __SINGULAR_PASCAL__Repository } from '../ports.js';
import { add__SINGULAR_PASCAL__, list__PLURAL_PASCAL__ } from './__PLURAL_KEBAB__.js';

const staff = (tenantId: string | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
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

const fakeRepo = (initial: __SINGULAR_PASCAL__[] = []) => {
  const store = [...initial];
  const repo: __SINGULAR_PASCAL__Repository = {
    listByTenant: async (tenantId) => store.filter((row) => row.tenantId === tenantId),
    create: async (row) => {
      store.push(row);
    },
  };
  return { repo, store };
};

const deps = (repo: __SINGULAR_PASCAL__Repository) => ({
  __PLURAL_CAMEL__: repo,
  ids: { nextId: () => '__SINGULAR_KEBAB__-1' },
  clock: { nowIso: () => '2026-07-03T00:00:00.000Z' },
});

describe('__PLURAL_KEBAB__ use-cases', () => {
  it('stamps tenant + author on create and scopes listing to the tenant', async () => {
    const { repo, store } = fakeRepo();
    const created = await add__SINGULAR_PASCAL__(
      { identity: staff('t-acme') },
      { title: 'First entry' },
      deps(repo),
    );
    expect(created).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', createdBy: 'u1', title: 'First entry' },
    });
    expect(store).toHaveLength(1);

    const listed = await list__PLURAL_PASCAL__({ identity: staff('t-acme') }, deps(repo));
    expect(listed.ok && listed.value.map((row) => row.title)).toEqual(['First entry']);
  });

  it('denies a tenant-less caller with forbidden before any repository access', async () => {
    const { repo, store } = fakeRepo();
    const listed = await list__PLURAL_PASCAL__({ identity: staff(null) }, deps(repo));
    expect(listed).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const added = await add__SINGULAR_PASCAL__({ identity: staff(null) }, { title: 'x' }, deps(repo));
    expect(added).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store).toHaveLength(0);
  });

  it('allows a tenant member to read and write (baseline collaborative policy — flip both expectations to a forbidden denial if you made this aggregate staff-only in authorization.ts)', async () => {
    const { repo, store } = fakeRepo([
      { id: '1', tenantId: 't-acme', title: 'seed', createdBy: 'u1', createdAt: 'x' },
    ]);
    const listed = await list__PLURAL_PASCAL__({ identity: member }, deps(repo));
    expect(listed.ok && listed.value.map((row) => row.id)).toEqual(['1']);

    const added = await add__SINGULAR_PASCAL__({ identity: member }, { title: 'from member' }, deps(repo));
    expect(added).toMatchObject({ ok: true, value: { tenantId: 't-acme', title: 'from member' } });
    expect(store).toHaveLength(2);
  });

  it.todo("add__SINGULAR_PASCAL__ rejects blank/oversized input with 'validation'");
  it.todo("list__PLURAL_PASCAL__ never returns another tenant's rows");
});
