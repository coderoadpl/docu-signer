import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliConfig } from './config.js';

interface ConfigModule {
  loadConfig: () => CliConfig;
  saveConfig: (config: CliConfig) => void;
}

const originalHome = process.env['HOME'];
const home = mkdtempSync(join(tmpdir(), 'apa-cli-config-'));
const configFile = join(home, '.config', 'agentproofarch', 'config.json');

let config: ConfigModule;

beforeAll(async () => {
  // config.ts resolves its path from homedir() at import time, so HOME must be
  // pinned to a throwaway directory before the module is first evaluated.
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
  mkdirSync(dirname(configFile), { recursive: true });
  rmSync(configFile, { force: true });
});

describe('loadConfig', () => {
  it('returns schema defaults on first run (no file yet)', () => {
    expect(config.loadConfig()).toEqual({
      apiUrl: 'http://localhost:47100',
      token: null,
      tenant: null,
    });
  });

  it('falls back to defaults when the file is malformed JSON', () => {
    writeFileSync(configFile, '{ not json');

    expect(config.loadConfig()).toEqual({
      apiUrl: 'http://localhost:47100',
      token: null,
      tenant: null,
    });
  });

  it('fills missing keys with defaults for a partial config file', () => {
    writeFileSync(configFile, JSON.stringify({ token: 'stored-token' }));

    expect(config.loadConfig()).toEqual({
      apiUrl: 'http://localhost:47100',
      token: 'stored-token',
      tenant: null,
    });
  });

  it('rejects a wrongly-typed field and returns defaults', () => {
    writeFileSync(configFile, JSON.stringify({ apiUrl: 42 }));

    expect(config.loadConfig()).toEqual({
      apiUrl: 'http://localhost:47100',
      token: null,
      tenant: null,
    });
  });
});

describe('saveConfig', () => {
  it('creates the config under HOME/.config and round-trips through loadConfig', () => {
    config.saveConfig({ apiUrl: 'https://api.test', token: 'tok', tenant: 'acme' });

    expect(config.loadConfig()).toEqual({
      apiUrl: 'https://api.test',
      token: 'tok',
      tenant: 'acme',
    });
    const onDisk: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(onDisk).toEqual({ apiUrl: 'https://api.test', token: 'tok', tenant: 'acme' });
  });

  it('writes the config file with owner-only (0600) permissions', () => {
    config.saveConfig({ apiUrl: 'https://api.test', token: null, tenant: null });

    expect(statSync(configFile).mode & 0o777).toBe(0o600);
  });

  it('overwrites a previously stored token (e.g. logout clears it)', () => {
    config.saveConfig({ apiUrl: 'https://api.test', token: 'tok', tenant: 'acme' });
    config.saveConfig({ apiUrl: 'https://api.test', token: null, tenant: 'acme' });

    expect(config.loadConfig().token).toBeNull();
  });
});
