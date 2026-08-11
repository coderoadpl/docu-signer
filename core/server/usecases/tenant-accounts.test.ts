import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '#core/domain/index.js';

import { listTenantAccounts } from './tenant-accounts.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'account-1',
  email: 'maria@example.com',
  name: 'Maria Choma',
  tenantId,
  tenantSlug: tenantId ? 'default' : null,
  tenantName: tenantId ? 'Archiwum' : null,
  staffRole: tenantId ? 'owner' : null,
  apiToken: null,
});

describe('tenant account use-cases', () => {
  it('authorizes before listing tenant accounts', async () => {
    const listByTenant = vi.fn(async () => [
      { accountId: 'account-1', name: 'Maria Choma' },
    ]);
    const denied = await listTenantAccounts(
      { identity: identity(null) },
      { tenantAccounts: { listByTenant } },
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(listByTenant).not.toHaveBeenCalled();

    await expect(
      listTenantAccounts(
        { identity: identity('tenant-default') },
        { tenantAccounts: { listByTenant } },
      ),
    ).resolves.toEqual({
      ok: true,
      value: [{ accountId: 'account-1', name: 'Maria Choma' }],
    });
    expect(listByTenant).toHaveBeenCalledExactlyOnceWith('tenant-default');
  });
});
