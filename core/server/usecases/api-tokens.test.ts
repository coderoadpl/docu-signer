import { describe, expect, it, vi } from 'vitest';

import type { ApiToken, Identity } from '#core/domain/index.js';
import type { ApiTokenDeps, ApiTokenRepository } from '#core/server/index.js';

import { createApiToken, listApiTokens, revokeApiToken } from './api-tokens.js';

const tokenId = '11111111-1111-4111-8111-111111111111';

const owner: Identity = {
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'tenant-default',
  tenantSlug: 'default',
  tenantName: 'Archive',
  staffRole: 'owner',
  apiToken: null,
};

const ctx = (identity: Identity) => ({ identity });

const fake = (): ApiTokenDeps => {
  const tokens: ApiToken[] = [];
  const repository: ApiTokenRepository = {
    create: async (input) => {
      const token: ApiToken = {
        id: input.id,
        userId: input.userId,
        name: input.name,
        scopes: input.scopes,
        createdAt: '2026-08-02T10:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      };
      tokens.push(token);
      return token;
    },
    listByUser: async (userId) => tokens.filter((token) => token.userId === userId),
    findActiveByHash: async () => null,
    markUsed: async () => {},
    revoke: async (userId, apiTokenId) => {
      const index = tokens.findIndex((token) => token.userId === userId && token.id === apiTokenId);
      const token = tokens[index];
      if (!token) return false;
      tokens[index] = { ...token, revokedAt: '2026-08-02T11:00:00.000Z' };
      return true;
    },
  };
  return {
    apiTokens: repository,
    apiTokenSecrets: {
      generate: () => 'pat_secret',
      hash: (value) => `hash:${value}`,
      matchesHash: (value, tokenHash) => `hash:${value}` === tokenHash,
    },
    ids: { nextId: () => tokenId },
  };
};

describe('api token use-cases', () => {
  it('creates a token value once and never exposes the stored hash', async () => {
    const deps = fake();
    const created = await createApiToken(
      ctx(owner),
      { name: 'Importer', scopes: ['write:draft'] },
      deps,
    );
    expect(created).toMatchObject({
      ok: true,
      value: {
        value: 'pat_secret',
        token: { id: tokenId, name: 'Importer', scopes: ['write:draft'] },
      },
    });
    const listed = await listApiTokens(ctx(owner), deps);
    expect(listed).toMatchObject({
      ok: true,
      value: [{ id: tokenId, name: 'Importer' }],
    });
    expect(JSON.stringify(listed)).not.toContain('hash:');
  });

  it('is session-only and denies before repository access for API token identities', async () => {
    const deps = fake();
    const createSpy = vi.spyOn(deps.apiTokens, 'create');
    const tokenIdentity: Identity = {
      ...owner,
      apiToken: { id: tokenId, scopes: ['write'] as const },
    };
    await expect(createApiToken(ctx(tokenIdentity), { name: 'x', scopes: ['read'] }, deps))
      .resolves
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('lists and revokes only the signed-in user token rows', async () => {
    const deps = fake();
    await createApiToken(ctx(owner), { name: 'Importer', scopes: ['read', 'write:draft'] }, deps);
    expect(await revokeApiToken(ctx(owner), tokenId, deps)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await revokeApiToken(ctx(owner), '22222222-2222-4222-8222-222222222222', deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
