import { describe, expect, it, vi } from 'vitest';

import type { ApiTokenScope, Identity, TenantSettings } from '#core/domain/index.js';
import type { TenantSettingsRepository } from '../ports.js';
import { sealSigningTime } from './pdf-sealing.js';
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
    set: async (tenantId, settings) => {
      value = { tenantId, ...settings };
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
      value: {
        tenantId: 'tenant-1',
        storeSignatureRecords: true,
        pdfSealEnabled: false,
        dateMode: 'declared',
      },
    });
    await expect(
      updateTenantSettings(ctx, { storeSignatureRecords: false }, { tenantSettings }),
    ).resolves.toEqual({
      ok: true,
      value: {
        tenantId: 'tenant-1',
        storeSignatureRecords: false,
        pdfSealEnabled: false,
        dateMode: 'declared',
      },
    });
    await expect(getTenantSettings(ctx, { tenantSettings })).resolves.toMatchObject({
      ok: true,
      value: { storeSignatureRecords: false },
    });
    await expect(
      updateTenantSettings(
        ctx,
        { pdfSealEnabled: true, dateMode: 'actual' },
        { tenantSettings },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        storeSignatureRecords: false,
        pdfSealEnabled: true,
        dateMode: 'actual',
      },
    });
  });

  it('applies declared and actual date policies at signing time', () => {
    const now = new Date('2026-08-09T14:15:16.789Z');
    expect(sealSigningTime('declared', '2020-02-03', now).toISOString()).toBe(
      '2020-02-03T14:15:16.000Z',
    );
    expect(sealSigningTime('actual', '2020-02-03', now)).toBe(now);
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
