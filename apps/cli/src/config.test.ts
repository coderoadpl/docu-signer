import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CliConfig,
  CliProfile,
  ResolveCliConfigInput,
  ResolvedCliConfig,
} from './config.js';

interface ConfigModule {
  DEFAULT_DEV_API_URL: string;
  apiOrigin: (apiUrl: string) => string;
  isPodpisyRepo: (cwd: string) => boolean;
  loadConfig: () => CliConfig;
  resolveCliConfig: (input: ResolveCliConfigInput) => ResolvedCliConfig;
  saveConfig: (config: CliConfig) => void;
  updateOriginProfile: (
    config: CliConfig,
    origin: string,
    patch: Partial<CliProfile>,
    setCurrent: boolean,
  ) => CliConfig;
}

const originalHome = process.env['HOME'];
const home = mkdtempSync(join(tmpdir(), 'podpisy-cli-config-'));
const configDir = join(home, '.config', 'agentproofarch');
const configFile = join(configDir, 'config.json');
const outsideRepo = join(home, 'outside');
const repo = join(home, 'renamed-checkout');
const repoChild = join(repo, 'apps', 'cli');

let config: ConfigModule;

beforeAll(async () => {
  process.env['HOME'] = home;
  vi.resetModules();
  config = await import('./config.js');
});

afterAll(() => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(outsideRepo, { recursive: true });
  mkdirSync(repoChild, { recursive: true });
  rmSync(configFile, { force: true });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'podpisy' }));
});

const v2 = (
  currentOrigin = 'https://one.example',
  profiles: Record<string, CliProfile> = {},
): CliConfig => ({
  version: 2,
  currentOrigin,
  profiles,
});

describe('loadConfig', () => {
  it('returns an unwritten empty config on first run', () => {
    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {},
    });
    expect(() => statSync(configFile)).toThrow();
  });

  it('migrates a legacy profile without changing token or tenant bytes', () => {
    const token = 'tok\u0000é\n終';
    const tenant = 'tenant-with-dashes';
    writeFileSync(
      configFile,
      JSON.stringify({
        apiUrl: 'HTTPS://Example.COM:443/path?ignored=yes',
        token,
        tenant,
      }),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: 'https://example.com',
      profiles: {
        'https://example.com': { token, tenant },
      },
    });
    expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({
      version: 2,
      currentOrigin: 'https://example.com',
      profiles: {
        'https://example.com': { token, tenant },
      },
    });
    expect(error).toHaveBeenCalledExactlyOnceWith(
      'podpisy: migrated ~/.config/agentproofarch/config.json to per-origin profiles (https://example.com)',
    );
  });

  it.each([
    ['an absent apiUrl', { token: 'tok', tenant: null }],
    ['an unparseable apiUrl', { apiUrl: 'not a URL', token: 'tok', tenant: null }],
  ])('migrates %s under the dev origin', (_label, legacy) => {
    writeFileSync(configFile, JSON.stringify(legacy));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {
        [config.DEFAULT_DEV_API_URL]: { token: 'tok', tenant: null },
      },
    });
  });

  it('fails loudly on malformed JSON and leaves the file byte-for-byte unchanged', () => {
    const corrupted = '{ "token": "live", nope';
    writeFileSync(configFile, corrupted);

    expect(() => config.loadConfig()).toThrow(
      'podpisy: invalid ~/.config/agentproofarch/config.json: malformed JSON',
    );
    expect(readFileSync(configFile, 'utf8')).toBe(corrupted);
  });

  it('fails loudly on a corrupted legacy field and never resets the file', () => {
    const corrupted = JSON.stringify({ apiUrl: 'https://one.example', token: 42, tenant: null });
    writeFileSync(configFile, corrupted);

    expect(() => config.loadConfig()).toThrow(
      'podpisy: invalid ~/.config/agentproofarch/config.json',
    );
    expect(readFileSync(configFile, 'utf8')).toBe(corrupted);
  });

  it('fails loudly on a corrupted version-2 profile and never resets the file', () => {
    const corrupted = JSON.stringify({
      version: 2,
      currentOrigin: 'https://one.example',
      profiles: {
        'https://one.example': { token: 42, tenant: null },
      },
    });
    writeFileSync(configFile, corrupted);

    expect(() => config.loadConfig()).toThrow(
      'podpisy: invalid ~/.config/agentproofarch/config.json',
    );
    expect(readFileSync(configFile, 'utf8')).toBe(corrupted);
  });

  it('does not rewrite a valid JSON shape from a future version on read', () => {
    const future = JSON.stringify({ version: 3, currentOrigin: 'opaque', profiles: [] });
    writeFileSync(configFile, future);

    expect(config.loadConfig()).toEqual({
      version: 2,
      currentOrigin: config.DEFAULT_DEV_API_URL,
      profiles: {},
    });
    expect(readFileSync(configFile, 'utf8')).toBe(future);
  });
});

describe('saveConfig', () => {
  it('atomically writes an owner-only file and leaves no sibling temp file', () => {
    const saved = v2('https://one.example', {
      'https://one.example': { token: 'tok', tenant: 'acme' },
    });

    config.saveConfig(saved);

    expect(config.loadConfig()).toEqual(saved);
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(configDir)).toEqual(['config.json']);
  });

  it('updates one origin without clobbering another', () => {
    const initial = v2('https://one.example', {
      'https://one.example': { token: 'one-token', tenant: 'one' },
      'https://two.example': { token: 'two-token', tenant: 'two' },
    });

    expect(
      config.updateOriginProfile(initial, 'https://two.example', { token: 'new-two' }, true),
    ).toEqual({
      version: 2,
      currentOrigin: 'https://two.example',
      profiles: {
        'https://one.example': { token: 'one-token', tenant: 'one' },
        'https://two.example': { token: 'new-two', tenant: 'two' },
      },
    });
  });

  it('persists the repo-default profile without moving currentOrigin', () => {
    const initial = v2('https://production.example', {
      'https://production.example': { token: 'production-token', tenant: 'production' },
    });

    expect(
      config.updateOriginProfile(
        initial,
        config.DEFAULT_DEV_API_URL,
        { token: 'local-token' },
        false,
      ),
    ).toEqual({
      version: 2,
      currentOrigin: 'https://production.example',
      profiles: {
        'https://production.example': {
          token: 'production-token',
          tenant: 'production',
        },
        [config.DEFAULT_DEV_API_URL]: { token: 'local-token', tenant: null },
      },
    });
  });
});

describe('repo detection', () => {
  it('detects the package marker from a renamed checkout child', () => {
    expect(config.isPodpisyRepo(repoChild)).toBe(true);
  });

  it('does not misfire outside the checkout or on a different package name', () => {
    writeFileSync(join(outsideRepo, 'package.json'), JSON.stringify({ name: 'another-project' }));

    expect(config.isPodpisyRepo(outsideRepo)).toBe(false);
  });

  it('ignores missing and unparseable package files while walking upward', () => {
    writeFileSync(join(repo, 'apps', 'package.json'), '{ bad json');

    expect(config.isPodpisyRepo(repoChild)).toBe(true);
  });
});

describe('precedence', () => {
  const stored = v2('https://stored.example', {
    'https://stored.example': { token: 'stored-token', tenant: 'stored-tenant' },
    'https://env.example': { token: 'env-token', tenant: 'env-tenant' },
    'https://flag.example': { token: 'flag-token', tenant: 'flag-tenant' },
    [config?.DEFAULT_DEV_API_URL ?? 'http://localhost:47100']: {
      token: 'dev-token',
      tenant: 'dev-tenant',
    },
  });

  it('uses --api-url over env, repo detection, and stored currentOrigin', () => {
    const resolved = config.resolveCliConfig({
      config: stored,
      cwd: repoChild,
      env: { APP_CLI_API_URL: 'https://env.example/path' },
      apiUrl: 'https://FLAG.example:443/api',
    });

    expect(resolved).toMatchObject({
      apiUrl: 'https://FLAG.example:443/api',
      origin: 'https://flag.example',
      originSource: 'flag',
      profile: { token: 'flag-token', tenant: 'flag-tenant' },
    });
  });

  it('uses APP_CLI_API_URL over repo detection and stored currentOrigin', () => {
    expect(
      config.resolveCliConfig({
        config: stored,
        cwd: repoChild,
        env: { APP_CLI_API_URL: 'https://env.example/path' },
      }),
    ).toMatchObject({
      apiUrl: 'https://env.example/path',
      origin: 'https://env.example',
      originSource: 'env',
      profile: { token: 'env-token', tenant: 'env-tenant' },
    });
  });

  it('uses the repo dev default over stored currentOrigin', () => {
    expect(
      config.resolveCliConfig({ config: stored, cwd: repoChild, env: {} }),
    ).toMatchObject({
      apiUrl: config.DEFAULT_DEV_API_URL,
      origin: config.DEFAULT_DEV_API_URL,
      originSource: 'repo',
      profile: { token: 'dev-token', tenant: 'dev-tenant' },
    });
  });

  it('uses currentOrigin outside the repo', () => {
    expect(
      config.resolveCliConfig({ config: stored, cwd: outsideRepo, env: {} }),
    ).toMatchObject({
      apiUrl: 'https://stored.example',
      origin: 'https://stored.example',
      originSource: 'stored',
      profile: { token: 'stored-token', tenant: 'stored-tenant' },
    });
  });

  it('uses --tenant, then APP_CLI_TENANT, then the selected profile tenant', () => {
    const base = {
      config: stored,
      cwd: outsideRepo,
      env: { APP_CLI_API_URL: 'https://env.example' },
    };

    expect(config.resolveCliConfig({ ...base, tenant: 'flag-tenant' }).tenant).toBe(
      'flag-tenant',
    );
    expect(
      config.resolveCliConfig({
        ...base,
        env: { ...base.env, APP_CLI_TENANT: 'environment-tenant' },
      }).tenant,
    ).toBe('environment-tenant');
    expect(config.resolveCliConfig(base).tenant).toBe('env-tenant');
  });
});
