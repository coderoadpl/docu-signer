import { describe, expect, it, vi } from 'vitest';

import type { HiddenFilterValue, Identity } from '#core/domain/index.js';

import type { HiddenFilterValueRepository } from '../ports.js';
import {
  hideFilterValue,
  listHiddenFilterValues,
  unhideFilterValue,
} from './hidden-filter-values.js';

const identity = (tenantId: string | null, role: 'owner' | 'admin' | null = 'owner'): Identity => ({
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Archive' : null,
  staffRole: tenantId ? role : null,
  apiToken: null,
});

const repository = (): HiddenFilterValueRepository => {
  const rows: HiddenFilterValue[] = [];
  return {
    listByTenant: async (tenantId) => rows.filter((row) => row.tenantId === tenantId),
    hide: async (input) => {
      const existing = rows.find(
        (row) =>
          row.tenantId === input.tenantId &&
          row.kind === input.kind &&
          row.value === input.value,
      );
      if (existing) return existing;
      rows.push(input);
      return input;
    },
    unhide: async (tenantId, kind, value) => {
      const index = rows.findIndex(
        (row) => row.tenantId === tenantId && row.kind === kind && row.value === value,
      );
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
};

const deps = (hiddenFilterValues: HiddenFilterValueRepository) => ({
  hiddenFilterValues,
  ids: { nextId: () => '11111111-1111-4111-8111-111111111111' },
});

describe('hidden filter value use-cases', () => {
  it('authorizes before accessing the repository', async () => {
    const hiddenFilterValues = repository();
    const spies = [
      vi.spyOn(hiddenFilterValues, 'listByTenant'),
      vi.spyOn(hiddenFilterValues, 'hide'),
      vi.spyOn(hiddenFilterValues, 'unhide'),
    ];
    const ctx = { identity: identity(null, null) };

    await expect(listHiddenFilterValues(ctx, deps(hiddenFilterValues))).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      hideFilterValue(ctx, { kind: 'person', value: 'Jan' }, deps(hiddenFilterValues)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(
      unhideFilterValue(ctx, { kind: 'person', value: 'Jan' }, deps(hiddenFilterValues)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('hides idempotently, lists per tenant and unhides once', async () => {
    const hiddenFilterValues = repository();
    const scoped = deps(hiddenFilterValues);
    const ctx = { identity: identity('tenant-default', 'admin') };

    await expect(
      hideFilterValue(ctx, { kind: 'person', value: '  Jan Kowalski  ' }, scoped),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: 'tenant-default',
        kind: 'person',
        value: 'Jan Kowalski',
      },
    });
    await expect(
      hideFilterValue(ctx, { kind: 'person', value: 'Jan Kowalski' }, scoped),
    ).resolves.toMatchObject({ ok: true, value: { value: 'Jan Kowalski' } });
    await expect(listHiddenFilterValues(ctx, scoped)).resolves.toMatchObject({
      ok: true,
      value: [{ kind: 'person', value: 'Jan Kowalski' }],
    });

    await expect(
      unhideFilterValue(ctx, { kind: 'person', value: 'Jan Kowalski' }, scoped),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      unhideFilterValue(ctx, { kind: 'person', value: 'Jan Kowalski' }, scoped),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(listHiddenFilterValues(ctx, scoped)).resolves.toMatchObject({
      ok: true,
      value: [],
    });
  });

  it('rejects an empty value with the validation taxonomy', async () => {
    const hiddenFilterValues = repository();
    const ctx = { identity: identity('tenant-default') };

    await expect(
      hideFilterValue(ctx, { kind: 'tag', value: '   ' }, deps(hiddenFilterValues)),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
