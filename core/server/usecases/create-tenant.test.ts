import { describe, expect, it } from 'vitest';

import type { Identity, Tenant } from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';
import { createTenant } from './create-tenant.js';

interface OwnerGrantRecord {
  id: string;
  tenantId: string;
  userId: string;
  staffRole: 'owner';
}

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

const memberIdentity: Identity = {
  userId: 'u2',
  email: 'member@example.com',
  name: 'Member',
  tenantId: 't-acme',
  tenantSlug: 'acme',
  tenantName: 'Acme Inc',
  staffRole: null,
  memberId: 'm-1',
};

const ownerIdentity: Identity = {
  ...identity,
  staffRole: 'owner',
};

const fakeTenants = (initialTenants: Tenant[] = []) => {
  const tenants = [...initialTenants];
  const ownerGrants: OwnerGrantRecord[] = [];

  const repo: TenantRepository = {
    findById: async (tenantId) => tenants.find((tenant) => tenant.id === tenantId) ?? null,
    findBySlug: async (slug) => tenants.find((tenant) => tenant.slug === slug) ?? null,
    createTenantWithOwner: async (input) => {
      const tenant = { id: input.tenant.id, slug: input.tenant.slug, name: input.tenant.name };
      tenants.push(tenant);
      ownerGrants.push({
        id: input.ownerGrant.id,
        tenantId: tenant.id,
        userId: input.ownerGrant.userId,
        staffRole: 'owner',
      });
      return tenant;
    },
    deleteTenant: async (tenantId) => {
      const index = tenants.findIndex((tenant) => tenant.id === tenantId);
      if (index >= 0) tenants.splice(index, 1);
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
      { identity, tenantCreationMode: 'open' },
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

  it('denies an end-customer member with forbidden before touching the repository', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity: memberIdentity, tenantCreationMode: 'open' },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('denies a visitor under staff mode before touching the repository', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity, tenantCreationMode: 'staff' },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('denies an owner under closed mode before touching the repository', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity: ownerIdentity, tenantCreationMode: 'closed' },
      { slug: 'new-co', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects slug conflicts before creating records', async () => {
    const store = fakeTenants([{ id: 't-acme', slug: 'acme', name: 'Acme' }]);

    const result = await createTenant(
      { identity, tenantCreationMode: 'open' },
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

  it('normalizes free-form slug input before writing', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity, tenantCreationMode: 'open' },
      { slug: '  New Co!!  ', name: 'New Co' },
      deps(store.repo),
    );

    expect(result).toMatchObject({ ok: true, value: { slug: 'new-co' } });
    expect(store.tenants).toEqual([{ id: 't-new', slug: 'new-co', name: 'New Co' }]);
  });

  it('rejects a reserved slug before writing', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity, tenantCreationMode: 'open' },
      { slug: 'admin', name: 'Invalid' },
      deps(store.repo),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Slug is reserved' },
    });
    expect(store.tenants).toEqual([]);
    expect(store.ownerGrants).toEqual([]);
  });

  it('rejects a blank name after a valid slug', async () => {
    const store = fakeTenants();

    const result = await createTenant(
      { identity, tenantCreationMode: 'open' },
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
