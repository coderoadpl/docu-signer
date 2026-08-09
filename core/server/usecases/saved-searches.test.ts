import { describe, expect, it, vi } from 'vitest';

import type { Identity, SavedSearch } from '#core/domain/index.js';
import type { SavedSearchRepository } from '../ports.js';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  type SavedSearchDeps,
} from './saved-searches.js';

const savedSearchId = '11111111-1111-4111-8111-111111111111';

const staff = (tenantId: string | null, role: 'owner' | 'admin' = 'owner'): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Archive' : null,
  staffRole: tenantId ? role : null,
  apiToken: null,
});

const visitor: Identity = {
  userId: 'u2',
  email: 'visitor@example.com',
  name: 'Visitor',
  tenantId: 'tenant-a',
  tenantSlug: 'a',
  tenantName: 'A',
  staffRole: null,
  apiToken: null,
};

const row = (tenantId = 'tenant-a', id = savedSearchId): SavedSearch => ({
  id,
  tenantId,
  name: 'Protokoły Anny',
  filter: { docType: 'protokol', person: 'Anna', tag: 'odbiór' },
  createdAt: '2026-08-01T10:00:00.000Z',
});

const fake = (initial: SavedSearch[] = []) => {
  const savedSearches = [...initial];
  const repository: SavedSearchRepository = {
    listByTenant: async (tenantId) =>
      savedSearches.filter((savedSearch) => savedSearch.tenantId === tenantId),
    create: async (input) => {
      const created: SavedSearch = {
        ...input,
        createdAt: '2026-08-01T10:00:00.000Z',
      };
      savedSearches.push(created);
      return created;
    },
    delete: async (tenantId, id) => {
      const index = savedSearches.findIndex(
        (savedSearch) => savedSearch.tenantId === tenantId && savedSearch.id === id,
      );
      if (index < 0) return false;
      savedSearches.splice(index, 1);
      return true;
    },
  };
  return {
    deps: {
      savedSearches: repository,
      ids: { nextId: () => savedSearchId },
    },
    savedSearches,
  };
};

const ctx = (identity: Identity) => ({ identity });

describe('saved search use-cases', () => {
  it('denies every use-case before repository access', async () => {
    const cases = [
      {
        name: 'listSavedSearches',
        run: (deps: SavedSearchDeps) => listSavedSearches(ctx(visitor), deps),
      },
      {
        name: 'createSavedSearch',
        run: (deps: SavedSearchDeps) =>
          createSavedSearch(ctx(staff(null)), { name: 'Teczka', filter: {} }, deps),
      },
      {
        name: 'deleteSavedSearch',
        run: (deps: SavedSearchDeps) => deleteSavedSearch(ctx(visitor), savedSearchId, deps),
      },
    ];

    for (const testCase of cases) {
      const state = fake([row()]);
      const repositorySpies = [
        vi.spyOn(state.deps.savedSearches, 'listByTenant'),
        vi.spyOn(state.deps.savedSearches, 'create'),
        vi.spyOn(state.deps.savedSearches, 'delete'),
      ];
      const result = await testCase.run(state.deps);
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      for (const repositorySpy of repositorySpies) {
        expect(repositorySpy, `${testCase.name} touched the repository before denial`).not.toHaveBeenCalled();
      }
    }
  });

  it('creates, lists and deletes only within the resolved tenant', async () => {
    const state = fake([row('tenant-b', '22222222-2222-4222-8222-222222222222')]);

    const created = await createSavedSearch(
      ctx(staff('tenant-a')),
      { name: '  Umowy Anny ', filter: { docType: 'umowa-uod', person: ' Anna ' } },
      state.deps,
    );
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: savedSearchId,
        tenantId: 'tenant-a',
        name: 'Umowy Anny',
        filter: { docType: 'umowa-uod', person: 'Anna' },
      },
    });

    const listed = await listSavedSearches(ctx(staff('tenant-a', 'admin')), state.deps);
    expect(listed.ok && listed.value.map((savedSearch) => savedSearch.tenantId)).toEqual(['tenant-a']);

    expect(await deleteSavedSearch(ctx(staff('tenant-b')), savedSearchId, state.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await deleteSavedSearch(ctx(staff('tenant-a')), savedSearchId, state.deps)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects invalid saved search filters before create', async () => {
    const state = fake();
    const create = vi.spyOn(state.deps.savedSearches, 'create');

    const result = await createSavedSearch(
      ctx(staff('tenant-a')),
      { name: 'Błędna', filter: { dateFrom: '2026-08-02', dateTo: '2026-08-01' } },
      state.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(create).not.toHaveBeenCalled();
  });
});
