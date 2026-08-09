import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appError, err, ok } from '#core/domain/index.js';

import { runLoginAction } from './main.js';

const root = join(import.meta.dirname, '..', '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const CLI_TEST_TIMEOUT_MS = 15_000;

const run = (...args: string[]) =>
  spawnSync(tsx, ['apps/cli/src/main.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });

describe('CLI command surface', () => {
  it('exposes document, auth, health, public, and origin commands only', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('document');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('health');
    expect(result.stdout).toContain('origin');
    expect(result.stdout).toContain('public');
    expect(result.stdout).not.toMatch(/^\s+(todo|card|member|staff|tenant|domain)\b/m);
    expect(result.stdout).not.toContain('--tenant');

    const loginHelp = run('login', '--help');
    expect(loginHelp.status).toBe(0);
    expect(loginHelp.stdout).toContain('--code <totp>');
  }, CLI_TEST_TIMEOUT_MS);

  it('maps an unknown removed command to the validation exit code', () => {
    const result = run('--json', 'todo', 'list');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

});

describe('login action', () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('keeps password-only login unchanged and stores the session token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const saveToken = vi.fn();

    await runLoginAction({
      auth: {
        signIn: async () => ok({ token: 'tok-password' }),
        verifyTotp: async () => ok({ token: null }),
      },
      json: true,
      saveToken,
    }, { email: 'plain@example.com', password: 'pw' });

    expect(saveToken).toHaveBeenCalledExactlyOnceWith('tok-password');
    expect(error).not.toHaveBeenCalled();
    const [line] = log.mock.calls[0] ?? [];
    expect(JSON.parse(String(line))).toEqual({ ok: true, data: { token: 'tok-password' } });
  });

  it('requires --code when password sign-in is gated by TOTP', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runLoginAction({
      auth: {
        signIn: async () => ok({ token: null, twoFactorRequired: true }),
        verifyTotp: async () => ok({ token: 'tok-totp' }),
      },
      json: false,
      saveToken: vi.fn(),
    }, { email: 'tfa@example.com', password: 'pw' });

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith('error(unauthorized): Two-factor authentication required. Pass --code with the current code from your authenticator app.');
    expect(process.exitCode).toBe(3);
  });

  it('completes TOTP login with --code and stores the verified session token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const saveToken = vi.fn();

    await runLoginAction({
      auth: {
        signIn: async () => ok({ token: null, twoFactorRequired: true }),
        verifyTotp: async ({ code }) => ok({ token: `tok-${code}` }),
      },
      json: false,
      saveToken,
    }, { email: 'tfa@example.com', password: 'pw', code: '123456' });

    expect(saveToken).toHaveBeenCalledExactlyOnceWith('tok-123456');
    expect(log).toHaveBeenCalledExactlyOnceWith('signed in as tfa@example.com');
  });

  it('maps an invalid TOTP code through the auth taxonomy', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runLoginAction({
      auth: {
        signIn: async () => ok({ token: null, twoFactorRequired: true }),
        verifyTotp: async () => err(appError('unauthorized', 'Invalid code')),
      },
      json: true,
      saveToken: vi.fn(),
    }, { email: 'tfa@example.com', password: 'pw', code: '000000' });

    expect(error).not.toHaveBeenCalled();
    const [line] = log.mock.calls[0] ?? [];
    expect(JSON.parse(String(line))).toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Invalid code' },
    });
    expect(process.exitCode).toBe(3);
  });
});
