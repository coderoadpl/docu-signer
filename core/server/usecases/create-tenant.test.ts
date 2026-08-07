import { describe, expect, it } from 'vitest';

import type { Identity, Tenant } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';
import { createTenant } from './create-tenant.js';

type OwnerGrant = Parameters<TenantRepository['createOwnerGrant']>[0];

const identity: Identity = {
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
};

const fakeTenants = (initialTenants: Tenant[] = []) => {
  const tenants = [...initialTenants];
  const ownerGrants: OwnerGrant[] = [];

  const repo: TenantRepository = {
    findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
    createTenant: async (input) => {
      const tenant = { id: input.id, slug: input.slug, name: input.name };
      tenants.push(tenant);
      return tenant;
    },
    createOwnerGrant: async (input) => {
      ownerGrants.push(input);
    },
  };

  return { repo, tenants, ownerGrants };
};

const fakeIds = (ids: string[]) => ({
  nextId: () => {
    const next = ids.shift();
    if (!next) throw new Error('No fake ID available');
    return next;
  },
});

const deps = (repo: TenantRepository, ids: string[] = ['t-new', 'grant-new']) => ({
  tenants: repo,
  ids: fakeIds(ids),
  clock: { nowIso: () => '2026-07-11T00:00:00.000Z' },
});

describe('createTenant', () => {
  it('creates a tenant and grants the caller owner access', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toEqual({
      ok: true,
      value: { id: 't-new', slug: 'new-co', name: 'New Co' },
    });
    expect(store.ownerGrants).toEqual([
      {
        id: 'grant-new',
        tenantId: 't-new',
        userId: 'u1',
        staffRole: 'owner',
      },
    ]);
  });

  it('rejects slug conflicts before creating records', async () => {
    const store = fakeTenants([{ id: 't-acme', slug: 'acme', name: 'Acme' }]);

    const result = await createTenant(
      { identity },
      { slug: 'acme', name: 'Acme Duplicate' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'Tenant "acme" already exists' },
    });
    expect(store.tenants).toEqual([{ id: 't-acme', slug: 'acme', name: 'Acme' }]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('validates slug and name before writing', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'No Spaces', name: 'Invalid' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Tenant slug must be 3-63 lowercase letters, numbers or hyphens' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects a blank name after a valid slug', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity },
      { slug: 'valid-co', name: '   ' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Tenant name is required' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });
});
