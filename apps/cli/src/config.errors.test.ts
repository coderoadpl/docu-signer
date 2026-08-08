import { afterEach, describe, expect, it, vi } from 'vitest';

interface FsError extends Error {
  code: string;
}

const configFile = '/test-home/.config/agentproofarch/config.json';
const saved = {
  version: 2 as const,
  currentOrigin: 'https://one.example',
  profiles: {
    'https://one.example': { token: 'live-token', tenant: 'acme' },
  },
};

const createHarness = () => {
  const files = new Map<string, string>();
  const mkdirSync = vi.fn();
  const readFileSync = vi.fn((path: string) => {
    const content = files.get(path);
    if (content !== undefined) return content;
    const error: FsError = Object.assign(new Error('missing'), { code: 'ENOENT' });
    throw error;
  });
  const renameSync = vi.fn((from: string, to: string) => {
    const content = files.get(from);
    if (content === undefined) throw new Error('missing temporary file');
    files.set(to, content);
    files.delete(from);
  });
  const rmSync = vi.fn((path: string) => {
    files.delete(path);
  });
  const writeFileSync = vi.fn((path: string, content: string) => {
    files.set(path, content);
  });
  return { files, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync };
};

const loadConfigWith = async (harness: ReturnType<typeof createHarness>) => {
  vi.doMock('node:fs', () => ({
    mkdirSync: harness.mkdirSync,
    readFileSync: harness.readFileSync,
    renameSync: harness.renameSync,
    rmSync: harness.rmSync,
    writeFileSync: harness.writeFileSync,
  }));
  vi.doMock('node:os', () => ({ homedir: () => '/test-home' }));
  vi.resetModules();
  return import('./config.js');
};

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.doUnmock('node:os');
  vi.resetModules();
});

describe('config filesystem failure behavior', () => {
  it('surfaces non-ENOENT read errors without writing', async () => {
    const harness = createHarness();
    harness.readFileSync.mockImplementationOnce(() => {
      const error: FsError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      throw error;
    });
    const config = await loadConfigWith(harness);

    expect(() => config.loadConfig()).toThrow(
      'podpisy: could not read ~/.config/agentproofarch/config.json',
    );
    expect(harness.writeFileSync).not.toHaveBeenCalled();
    expect(harness.renameSync).not.toHaveBeenCalled();
  });

  it('preserves the token-bearing file and removes the temporary file after a write failure', async () => {
    const harness = createHarness();
    const original = JSON.stringify(saved);
    harness.files.set(configFile, original);
    harness.writeFileSync.mockImplementationOnce((path: string) => {
      harness.files.set(path, 'partial');
      throw new Error('disk full');
    });
    const config = await loadConfigWith(harness);

    expect(() => config.saveConfig(saved)).toThrow('disk full');
    expect(harness.files.get(configFile)).toBe(original);
    expect([...harness.files.keys()]).toEqual([configFile]);
    expect(harness.rmSync).toHaveBeenCalledTimes(1);
    expect(harness.renameSync).not.toHaveBeenCalled();
  });

  it('preserves the token-bearing file and removes the temporary file after a rename failure', async () => {
    const harness = createHarness();
    const original = JSON.stringify(saved);
    harness.files.set(configFile, original);
    harness.renameSync.mockImplementationOnce(() => {
      throw new Error('rename denied');
    });
    const config = await loadConfigWith(harness);

    expect(() => config.saveConfig(saved)).toThrow('rename denied');
    expect(harness.files.get(configFile)).toBe(original);
    expect([...harness.files.keys()]).toEqual([configFile]);
    expect(harness.rmSync).toHaveBeenCalledTimes(1);
  });
});
