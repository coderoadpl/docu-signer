import { describe, expect, it, vi } from 'vitest';

import type { Identity } from '#core/domain/index.js';
import type {
  InvitationDeps,
  InvitationRepository,
  InvitationWithHash,
} from '#core/server/index.js';

import {
  acceptInvitation,
  createInvitation,
  getInvitation,
  listInvitations,
  revokeInvitation,
} from './invitations.js';

const NOW = new Date('2026-08-10T10:00:00.000Z');
const INVITATION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'user-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'tenant-a',
  tenantSlug: 'default',
  tenantName: 'Archiwum',
  staffRole: 'owner',
  apiToken: null,
  ...overrides,
});

const createFake = () => {
  const rows: InvitationWithHash[] = [];
  const accounts = new Map<string, string>();
  let nextId = INVITATION_ID;
  const repository: InvitationRepository = {
    createOrReplace: async (input) => {
      const index = rows.findIndex(
        (row) => row.tenantId === input.tenantId && row.email === input.email && row.status === 'pending',
      );
      const row: InvitationWithHash = { ...input, status: 'pending' };
      if (index === -1) rows.push(row);
      else rows[index] = row;
      return row;
    },
    listByTenant: async (tenantId) => rows
      .filter((row) => row.tenantId === tenantId)
      .map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        role: row.role,
        invitedBy: row.invitedBy,
        status: row.status,
        expiresAt: row.expiresAt,
      })),
    findByTokenHash: async (tokenHash) => {
      const row = rows.find((candidate) => candidate.tokenHash === tokenHash);
      return row ? { ...row, organizationName: 'Archiwum' } : null;
    },
    hasAccount: async (email) => accounts.has(email),
    accept: async (invitationId, userId) => {
      const index = rows.findIndex((row) => row.id === invitationId && row.status === 'pending');
      const row = rows[index];
      if (!row) return false;
      rows[index] = { ...row, status: 'accepted' };
      accounts.set(row.email, userId);
      return true;
    },
    revoke: async (tenantId, invitationId) => {
      const index = rows.findIndex(
        (row) => row.tenantId === tenantId && row.id === invitationId && row.status === 'pending',
      );
      const row = rows[index];
      if (!row) return false;
      rows[index] = { ...row, status: 'revoked' };
      return true;
    },
    expire: async (invitationId) => {
      const index = rows.findIndex((row) => row.id === invitationId && row.status === 'pending');
      const row = rows[index];
      if (row) rows[index] = { ...row, status: 'expired' };
    },
    expirePastDue: async (tenantId, now) => {
      rows.forEach((row, index) => {
        if (row.tenantId === tenantId && row.status === 'pending' && row.expiresAt <= now) {
          rows[index] = { ...row, status: 'expired' };
        }
      });
    },
  };
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  const deps: InvitationDeps = {
    invitations: repository,
    invitationSecrets: {
      generate: () => 'invite_secret',
      hash: (value) => `hash:${value}`,
      matchesHash: (value, tokenHash) => `hash:${value}` === tokenHash,
    },
    invitationAuth: {
      createAccount: async ({ email }) => ({ userId: `account:${email}` }),
    },
    ids: {
      nextId: () => {
        const value = nextId;
        nextId = SECOND_ID;
        return value;
      },
    },
    now: () => NOW,
    baseUrl: 'https://podpisy.example.com/',
    baseDomain: 'example.com',
    invitationEmail: {
      sendMail: async (message) => {
        sent.push(message);
      },
    },
  };
  return { accounts, deps, repository, rows, sent };
};

const createOne = async (deps: InvitationDeps, email = 'new@example.com') =>
  createInvitation({ identity: identity() }, { email, role: 'admin' }, deps);

describe('invitation use-cases', () => {
  it('authorizes first and denies anonymous, API-token, and tenant-less identities', async () => {
    for (const denied of [
      identity({ staffRole: null }),
      identity({ apiToken: { id: 'token', scopes: ['write'] } }),
      identity({ tenantId: null }),
    ]) {
      const { deps } = createFake();
      const create = vi.spyOn(deps.invitations, 'createOrReplace');
      const list = vi.spyOn(deps.invitations, 'listByTenant');
      const revoke = vi.spyOn(deps.invitations, 'revoke');
      await createInvitation({ identity: denied }, { email: 'new@example.com', role: 'admin' }, deps);
      await listInvitations({ identity: denied }, deps);
      await revokeInvitation({ identity: denied }, INVITATION_ID, deps);
      expect(create).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(revoke).not.toHaveBeenCalled();
    }
  });

  it('creates a seven-day invitation, sends Polish mail, and exposes the raw token once', async () => {
    const { deps, sent } = createFake();
    const result = await createOne(deps, 'NEW@EXAMPLE.COM');
    expect(result).toMatchObject({
      ok: true,
      value: {
        invitation: { email: 'new@example.com', role: 'admin', status: 'pending' },
        url: 'https://podpisy.example.com/zaproszenie/invite_secret',
        emailSent: true,
      },
    });
    if (!result.ok) throw new Error('Invitation was not created');
    expect(result.value.invitation.expiresAt).toBe('2026-08-17T10:00:00.000Z');
    expect(sent).toEqual([
      expect.objectContaining({
        to: 'new@example.com',
        subject: 'Zaproszenie do archiwum Podpisy',
      }),
    ]);
    expect(JSON.stringify(await listInvitations({ identity: identity() }, deps))).not.toContain('invite_secret');
  });

  it('succeeds without mail and regenerating replaces the single pending invitation', async () => {
    const { deps, rows } = createFake();
    deps.invitationEmail = null;
    expect(await createOne(deps)).toMatchObject({ ok: true, value: { emailSent: false } });
    expect(await createOne(deps)).toMatchObject({
      ok: true,
      value: { invitation: { id: SECOND_ID } },
    });
    expect(rows).toHaveLength(1);
  });

  it('uses the tenant host when the configured URL is the base-domain apex', async () => {
    const { deps } = createFake();
    deps.baseUrl = 'http://localhost:47100';
    deps.baseDomain = 'localhost';
    await expect(createOne(deps)).resolves.toMatchObject({
      ok: true,
      value: { url: 'http://default.localhost:47100/zaproszenie/invite_secret' },
    });
  });

  it('lists by tenant and cannot revoke an invitation from another tenant', async () => {
    const { deps } = createFake();
    await createOne(deps);
    await expect(listInvitations({ identity: identity({ tenantId: 'tenant-b' }) }, deps)).resolves.toEqual({
      ok: true,
      value: [],
    });
    await expect(
      revokeInvitation({ identity: identity({ tenantId: 'tenant-b' }) }, INVITATION_ID, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(revokeInvitation({ identity: identity() }, INVITATION_ID, deps)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(getInvitation('invite_secret', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it('expires stale invitations and never creates an account for them', async () => {
    const { deps, rows } = createFake();
    await createOne(deps);
    const row = rows[0];
    if (!row) throw new Error('Missing invitation');
    rows[0] = { ...row, expiresAt: '2026-08-10T09:59:59.000Z' };
    const createAccount = vi.spyOn(deps.invitationAuth, 'createAccount');
    await expect(
      acceptInvitation('invite_secret', { password: 'new-password' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(createAccount).not.toHaveBeenCalled();
    expect(rows[0]?.status).toBe('expired');
  });

  it('accepts once, provisions through auth, and rejects replay idempotently', async () => {
    const { deps, rows } = createFake();
    await createOne(deps);
    const matchesHash = vi.spyOn(deps.invitationSecrets, 'matchesHash');
    await expect(
      getInvitation('invite_secret', deps),
    ).resolves.toEqual({
      ok: true,
      value: { email: 'new@example.com', organizationName: 'Archiwum', status: 'pending' },
    });
    await expect(
      acceptInvitation('invite_secret', { password: 'new-password' }, deps),
    ).resolves.toEqual({ ok: true, value: { email: 'new@example.com' } });
    expect(matchesHash).toHaveBeenCalled();
    expect(rows[0]?.status).toBe('accepted');
    await expect(
      acceptInvitation('invite_secret', { password: 'new-password' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('rejects existing accounts and invalid passwords', async () => {
    const { accounts, deps } = createFake();
    accounts.set('existing@example.com', 'existing-user');
    await expect(createOne(deps, 'existing@example.com')).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    await createOne(deps);
    await expect(acceptInvitation('invite_secret', { password: 'short' }, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('rejects invalid creation input, unknown tokens, hash mismatches, and a concurrent acceptance', async () => {
    const { deps } = createFake();
    await expect(
      createInvitation({ identity: identity() }, { email: 'not-an-email', role: 'admin' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    await expect(getInvitation('unknown', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await createOne(deps);
    deps.invitationSecrets.matchesHash = () => false;
    await expect(getInvitation('invite_secret', deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    deps.invitationSecrets.matchesHash = () => true;
    deps.invitations.accept = async () => false;
    await expect(
      acceptInvitation('invite_secret', { password: 'new-password' }, deps),
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
