import { describe, expect, it, vi } from 'vitest';

import type { Identity, UserPreference, UserPreferenceValue } from '#core/domain/index.js';
import type { UserPreferenceRepository } from '#core/server/index.js';

import { getUserPreference, setUserPreference } from './user-preferences.js';

const identity: Identity = {
  userId: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  tenantId: 'tenant-1',
  tenantSlug: 'default',
  tenantName: 'Default',
  staffRole: 'owner',
  apiToken: null,
};

const ctx = (overrides: Partial<Identity> = {}) => ({
  identity: { ...identity, ...overrides },
});

const repository = (): UserPreferenceRepository => {
  const store = new Map<string, UserPreference>();
  return {
    get: async (userId, key) => store.get(`${userId}:${key}`) ?? null,
    set: async (userId, key, value: UserPreferenceValue) => {
      const preference = {
        userId,
        key,
        value,
        updatedAt: '2026-08-02T10:00:00.000Z',
      };
      store.set(`${userId}:${key}`, preference);
      return preference;
    },
  };
};

describe('user preference use-cases', () => {
  it('sets and reads a preference for the signed-in user', async () => {
    const deps = { userPreferences: repository() };

    await expect(
      setUserPreference(
        ctx(),
        'documents.columns',
        { value: { order: ['title'], visible: ['title'] } },
        deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        userId: 'user-1',
        key: 'documents.columns',
        value: { order: ['title'], visible: ['title'] },
        updatedAt: '2026-08-02T10:00:00.000Z',
      },
    });

    await expect(getUserPreference(ctx(), 'documents.columns', deps)).resolves.toMatchObject({
      ok: true,
      value: {
        key: 'documents.columns',
        value: { order: ['title'], visible: ['title'] },
      },
    });
  });

  it('authorizes before repository access and validates keys', async () => {
    const prefs = repository();
    const getSpy = vi.spyOn(prefs, 'get');
    const setSpy = vi.spyOn(prefs, 'set');
    const tokenCtx = ctx({ apiToken: { id: 'token-1', scopes: ['read'] } });

    await expect(getUserPreference(tokenCtx, 'documents.columns', { userPreferences: prefs }))
      .resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await expect(setUserPreference(ctx(), 'Bad Key', { value: null }, { userPreferences: prefs }))
      .resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
