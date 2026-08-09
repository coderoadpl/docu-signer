import { describe, expect, it } from 'vitest';

import {
  apiOrigin,
  cliConfigSchema,
  DEFAULT_DEV_API_URL,
  resolveCliConfig,
  updateOriginProfile,
  type CliConfig,
} from './config.js';

const stored: CliConfig = {
  version: 3,
  currentOrigin: 'https://stored.example',
  profiles: {
    'https://stored.example': { token: 'stored-token' },
    'https://env.example': { token: 'env-token' },
  },
};

describe('CLI origin profiles', () => {
  it('stores only a session token per origin', () => {
    expect(cliConfigSchema.parse(stored)).toEqual(stored);
    expect(
      cliConfigSchema.safeParse({
        ...stored,
        profiles: {
          'https://stored.example': { token: 'stored-token', tenant: 'removed' },
        },
      }).success,
    ).toBe(false);
  });

  it('resolves flag, environment, repository, and stored origins in order', () => {
    const base = { config: stored, cwd: '/outside', env: {} };
    expect(
      resolveCliConfig({ ...base, apiUrl: 'https://flag.example/path' }),
    ).toMatchObject({
      apiUrl: 'https://flag.example/path',
      origin: 'https://flag.example',
      originSource: 'flag',
      profile: { token: null },
    });
    expect(
      resolveCliConfig({
        ...base,
        env: { APP_CLI_API_URL: 'https://env.example' },
      }),
    ).toMatchObject({
      origin: 'https://env.example',
      originSource: 'env',
      profile: { token: 'env-token' },
    });
    expect(resolveCliConfig(base)).toMatchObject({
      origin: 'https://stored.example',
      originSource: 'stored',
    });
  });

  it('updates one origin without changing another', () => {
    const updated = updateOriginProfile(
      stored,
      'https://new.example',
      { token: 'new-token' },
      true,
    );
    expect(updated.currentOrigin).toBe('https://new.example');
    expect(updated.profiles['https://new.example']).toEqual({ token: 'new-token' });
    expect(updated.profiles['https://stored.example']).toEqual({
      token: 'stored-token',
    });
  });

  it('canonicalizes API origins and retains the dev default', () => {
    expect(apiOrigin('https://archive.example/path')).toBe('https://archive.example');
    expect(DEFAULT_DEV_API_URL).toBe('http://localhost:47100');
  });
});
