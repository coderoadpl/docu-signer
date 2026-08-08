import { describe, expect, it } from 'vitest';

import { tenantContentVersion, type Tenant } from '#core/domain/index.js';
import type { TenantRepository } from '../ports.js';

import { getPublicTenantProfile } from './public.js';

const acme: Tenant = { id: 'tenant-acme', slug: 'acme', name: 'Acme Inc' };

const tenants = (findBySlug: TenantRepository['findBySlug']): { tenants: TenantRepository } => ({
  tenants: {
    findBySlug,
    findById: async () => null,
    createTenantWithOwner: async () => {
      throw new Error('unused');
    },
    deleteTenant: async () => {},
  },
});

describe('getPublicTenantProfile', () => {
  it('returns only the safe public fields for a known slug', async () => {
    const result = await getPublicTenantProfile({ slug: 'acme' }, tenants(async () => acme));
    expect(result).toEqual({
      ok: true,
      value: {
        slug: 'acme',
        displayName: 'Acme Inc',
        contentVersion: tenantContentVersion(acme),
      },
    });
  });

  it('never leaks the internal tenant id', async () => {
    const result = await getPublicTenantProfile({ slug: 'acme' }, tenants(async () => acme));
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.value)).not.toContain('tenant-acme');
  });

  it('returns a generic not_found for an unknown slug (non-enumerating)', async () => {
    const result = await getPublicTenantProfile({ slug: 'ghost' }, tenants(async () => null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.message).not.toContain('ghost');
    }
  });

  it('looks the tenant up by the requested slug', async () => {
    const seen: string[] = [];
    await getPublicTenantProfile(
      { slug: 'globex' },
      tenants(async (slug) => {
        seen.push(slug);
        return null;
      }),
    );
    expect(seen).toEqual(['globex']);
  });
});
