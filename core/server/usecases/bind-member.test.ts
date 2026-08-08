import { describe, expect, it } from 'vitest';

import type { Member } from '#core/domain/index.js';

import type { MemberRepository } from '../ports.js';
import { bindMemberOnSignIn } from './bind-member.js';

const provisioned: Member = {
  id: 'member-1',
  tenantId: 't-acme',
  userId: null,
  email: 'mag@example.com',
  displayName: 'Mag',
  tags: ['provisioned'],
  marketingConsents: [],
  externalCustomerIds: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: null,
};

const repo = (rows: Member[]): { deps: { members: MemberRepository; clock: { nowIso: () => string } }; rows: Member[] } => {
  const store = [...rows];
  return {
    rows: store,
    deps: {
      clock: { nowIso: () => '2026-07-20T12:00:00.000Z' },
      members: {
        listByTenant: async (tenantId) => store.filter((r) => r.tenantId === tenantId),
        findByEmail: async (tenantId, email) =>
          store.find((r) => r.tenantId === tenantId && r.email === email) ?? null,
        findByTenantAndId: async (tenantId, id) =>
          store.find((r) => r.tenantId === tenantId && r.id === id) ?? null,
        create: async (m) => {
          store.push(m);
        },
        update: async (m) => {
          const i = store.findIndex((r) => r.id === m.id);
          if (i >= 0) store[i] = m;
        },
        deleteByTenantAndId: async () => 0,
      },
    },
  };
};

describe('bindMemberOnSignIn', () => {
  it('claims a provisioned (null userId) member and stamps lastSeenAt', async () => {
    const { deps, rows } = repo([provisioned]);

    const bound = await bindMemberOnSignIn(
      { tenantId: 't-acme', userId: 'user-99', email: 'mag@example.com' },
      deps,
    );

    expect(bound).not.toBeNull();
    expect(bound?.userId).toBe('user-99');
    expect(bound?.lastSeenAt).toBe('2026-07-20T12:00:00.000Z');
    expect(rows[0]?.userId).toBe('user-99');
  });

  it('is a no-op when no member exists for (tenant, email)', async () => {
    const { deps } = repo([]);
    const bound = await bindMemberOnSignIn(
      { tenantId: 't-acme', userId: 'user-99', email: 'nobody@example.com' },
      deps,
    );
    expect(bound).toBeNull();
  });

  it('never rebinds or grants a member already bound to a different account', async () => {
    const alreadyBound: Member = { ...provisioned, userId: 'user-original' };
    const { deps, rows } = repo([alreadyBound]);

    const bound = await bindMemberOnSignIn(
      { tenantId: 't-acme', userId: 'user-intruder', email: 'mag@example.com' },
      deps,
    );

    expect(bound).toBeNull();
    expect(rows[0]?.userId).toBe('user-original');
  });

  it('scopes the claim to the tenant (same email in another tenant is untouched)', async () => {
    const otherTenant: Member = { ...provisioned, id: 'member-2', tenantId: 't-globex' };
    const { deps, rows } = repo([provisioned, otherTenant]);

    await bindMemberOnSignIn({ tenantId: 't-acme', userId: 'user-99', email: 'mag@example.com' }, deps);

    expect(rows.find((r) => r.id === 'member-1')?.userId).toBe('user-99');
    expect(rows.find((r) => r.id === 'member-2')?.userId).toBeNull();
  });
});
