import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSignPdfSeal } from '#adapters/pdf-seal/signpdf.js';
import { appError, err, ok } from '#core/domain/index.js';

import {
  loginCredentialSelectionIsValid,
  normalizeStdinPassword,
  runLoginAction,
  signatureRecordsProbeResult,
  verifySealBytes,
} from './main.js';

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
  it('exposes the allowed root commands only', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('account');
    expect(result.stdout).toContain('document');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('health');
    expect(result.stdout).toContain('origin');
    expect(result.stdout).toContain('public');
    expect(result.stdout).toContain('tenant-settings');
    expect(result.stdout).not.toMatch(/^\s+(todo|card|member|staff|tenant(?!-settings)|domain)\b/m);
    expect(result.stdout).not.toContain('--tenant');
  }, CLI_TEST_TIMEOUT_MS);

  it('documents login security options', () => {
    const loginHelp = run('login', '--help');
    expect(loginHelp.status).toBe(0);
    expect(loginHelp.stdout).toContain('--code <totp>');
    expect(loginHelp.stdout).toContain('--password <password>');
    expect(loginHelp.stdout).toContain('--password-stdin');
  }, CLI_TEST_TIMEOUT_MS);

  it('rejects password arguments combined with password stdin using the validation taxonomy', () => {
    const result = run(
      '--json',
      'login',
      '--email',
      'demo@example.com',
      '--password',
      'secret',
      '--password-stdin',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: 'Use either --password or --password-stdin, not both',
      },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('documents account password commands', () => {
    const accountHelp = run('account', '--help');
    expect(accountHelp.status).toBe(0);
    expect(accountHelp.stdout).toContain('change-password');
    expect(accountHelp.stdout).toContain('request-password-reset');
  }, CLI_TEST_TIMEOUT_MS);

  it('documents trash document commands', () => {
    const documentHelp = run('document', '--help');
    expect(documentHelp.status).toBe(0);
    expect(documentHelp.stdout).toContain('trash-list');
    expect(documentHelp.stdout).toContain('restore');
    expect(documentHelp.stdout).toContain('purge');
    expect(documentHelp.stdout).toContain('update-source');
    expect(documentHelp.stdout).toContain('verify-seal');
  }, CLI_TEST_TIMEOUT_MS);

  it('requires an explicit signature policy for source updates', () => {
    const result = run(
      '--json',
      'document',
      'update-source',
      '11111111-1111-4111-8111-111111111111',
      'nowe.pdf',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('maps an unknown removed command to the validation exit code', () => {
    const result = run('--json', 'todo', 'list');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('requires --yes before purging a document', () => {
    const result = run(
      '--json',
      'document',
      'purge',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

});

describe('document verify-seal', () => {
  it('maps valid and tampered CMS results through the CLI taxonomy', async () => {
    const adapter = createSignPdfSeal({
      kind: 'pem',
      certificate: await readFile(
        resolve(root, 'test/fixtures/pades-seal/certificate.pem'),
        'utf8',
      ),
      privateKey: await readFile(
        resolve(root, 'test/fixtures/pades-seal/private-key.pem'),
        'utf8',
      ),
    });
    if (!adapter.configured) throw new Error('Fixture seal adapter is not configured');
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const sealed = await adapter.seal({
      bytes: await pdf.save(),
      signingTime: new Date('2026-08-09T14:15:16.000Z'),
    });
    expect(verifySealBytes(sealed.bytes)).toMatchObject({
      ok: true,
      value: { integrity: true },
    });
    const tampered = new Uint8Array(sealed.bytes);
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(verifySealBytes(tampered)).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'PDF seal integrity check failed' },
    });
  });
});

describe('document show signature-records probe', () => {
  it('reports existence from a permitted probe', () => {
    expect(signatureRecordsProbeResult(ok({ items: [{}] }))).toBe(true);
    expect(signatureRecordsProbeResult(ok({ items: [] }))).toBe(false);
  });

  it('degrades to null when the probe is denied, so token callers still get the document', () => {
    expect(signatureRecordsProbeResult(err(appError('forbidden', 'denied')))).toBeNull();
  });
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

describe('stdin password normalization', () => {
  it('accepts exactly one password source', () => {
    expect(loginCredentialSelectionIsValid('secret', false)).toBe(true);
    expect(loginCredentialSelectionIsValid(undefined, true)).toBe(true);
    expect(loginCredentialSelectionIsValid('secret', true)).toBe(false);
    expect(loginCredentialSelectionIsValid(undefined, false)).toBe(false);
  });

  it('removes a Unix or Windows trailing newline without trimming password whitespace', () => {
    expect(normalizeStdinPassword(' secret \n')).toBe(' secret ');
    expect(normalizeStdinPassword('secret\r\n')).toBe('secret');
    expect(normalizeStdinPassword('secret')).toBe('secret');
  });
});
