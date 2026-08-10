import { describe, expect, it, vi } from 'vitest';

import type { ApiTokenScope, Identity, TenantSettings } from '#core/domain/index.js';
import type { TenantSettingsRepository } from '../ports.js';
import { getTenantSettings, updateTenantSettings } from './tenant-settings.js';

const identity = (scopes: readonly ApiTokenScope[] | null = null): Identity => ({
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'tenant-1',
  tenantSlug: 'default',
  tenantName: 'Default',
  staffRole: 'owner',
  apiToken: scopes ? { id: 'token-1', scopes } : null,
});

const repository = (): TenantSettingsRepository => {
  let value: TenantSettings | null = null;
  return {
    get: async () => value,
    set: async (tenantId, storeSignatureRecords) => {
      value = { tenantId, storeSignatureRecords };
      return value;
    },
  };
};

describe('tenant settings use-cases', () => {
  it('returns the on-by-default setting and updates it by tenant', async () => {
    const tenantSettings = repository();
    const ctx = { identity: identity() };

    await expect(getTenantSettings(ctx, { tenantSettings })).resolves.toEqual({
      ok: true,
      value: { tenantId: 'tenant-1', storeSignatureRecords: true },
    });
    await expect(
      updateTenantSettings(ctx, { storeSignatureRecords: false }, { tenantSettings }),
    ).resolves.toEqual({
      ok: true,
      value: { tenantId: 'tenant-1', storeSignatureRecords: false },
    });
    await expect(getTenantSettings(ctx, { tenantSettings })).resolves.toMatchObject({
      ok: true,
      value: { storeSignatureRecords: false },
    });
  });

  it('rejects a non-boolean setting without touching the repository', async () => {
    const tenantSettings = repository();
    const set = vi.spyOn(tenantSettings, 'set');

    await expect(
      updateTenantSettings(
        { identity: identity() },
        { storeSignatureRecords: 'yes' },
        { tenantSettings },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(set).not.toHaveBeenCalled();
  });

  it('denies read and write:draft tokens before repository access', async () => {
    for (const scopes of [['read'], ['write:draft']] as const) {
      const tenantSettings = repository();
      const get = vi.spyOn(tenantSettings, 'get');
      const set = vi.spyOn(tenantSettings, 'set');
      const ctx = { identity: identity(scopes) };

      await expect(getTenantSettings(ctx, { tenantSettings })).resolves.toMatchObject({
        ok: false,
        error: { code: 'forbidden' },
      });
      await expect(
        updateTenantSettings(ctx, { storeSignatureRecords: false }, { tenantSettings }),
      ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(get).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    }
  });
});
