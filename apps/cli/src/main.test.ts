import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '#core/client/index.js';
import { appError, err, ok } from '#core/domain/index.js';

import {
  documentListFilterFromOptions,
  linkDocumentsToTarget,
  listAllDocumentComments,
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
    expect(result.stdout).toContain('document-type');
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('health');
    expect(result.stdout).toContain('invitation');
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
    expect(documentHelp.stdout).toContain('unapprove');
    expect(documentHelp.stdout).toContain('waive-signature');
    expect(documentHelp.stdout).toContain('require-signature');
    expect(documentHelp.stdout).toContain('link');
    expect(documentHelp.stdout).toContain('unlink');
    expect(documentHelp.stdout).toContain('comment');
    expect(documentHelp.stdout).toContain('approve-link');
    expect(documentHelp.stdout).toContain('approve-comment');
    expect(documentHelp.stdout).toContain('propose-update');
    expect(documentHelp.stdout).toContain('proposal');
    expect(documentHelp.stdout).toContain('approve-proposal');
    expect(documentHelp.stdout).toContain('approve-proposals');
    expect(documentHelp.stdout).toContain('reject-proposal');
    const listHelp = run('document', 'list', '--help');
    expect(listHelp.status).toBe(0);
    expect(listHelp.stdout).toContain('--signer <accountId>');
    expect(listHelp.stdout).toContain('--pending-drafts');
    const proposalHelp = run('document', 'proposal', '--help');
    expect(proposalHelp.status).toBe(0);
    expect(proposalHelp.stdout).toContain('list');
  }, CLI_TEST_TIMEOUT_MS);

  it('maps the signer option to the document list contract filter', () => {
    expect(documentListFilterFromOptions({ signer: 'account-1' })).toEqual({
      signerAccountId: 'account-1',
    });
    expect(documentListFilterFromOptions({})).toEqual({});
    expect(documentListFilterFromOptions({ pendingDrafts: true })).toEqual({
      draft: 'all',
      pendingDrafts: 'true',
    });
  });

  it('maps invalid related-document IDs to the validation exit code', () => {
    const result = run(
      '--json',
      'document',
      'link',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'bad-id',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('maps an invalid comment document ID to the validation exit code', () => {
    const result = run('--json', 'document', 'comment', 'bad-id', 'Treść');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('maps invalid annotation approval IDs to the validation exit code', () => {
    for (const command of [
      'approve-link',
      'approve-comment',
      'approve-proposal',
      'reject-proposal',
    ]) {
      const result = run('--json', 'document', command, 'bad-id');
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: { code: 'validation' },
      });
    }
  }, CLI_TEST_TIMEOUT_MS);

  it('validates every document ID for bulk proposal approval', () => {
    const result = run(
      '--json',
      'document',
      'approve-proposals',
      '11111111-1111-4111-8111-111111111111',
      'bad-id',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('requires at least one metadata change for a proposal', () => {
    const result = run(
      '--json',
      'document',
      'propose-update',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('maps reversed proposal period dates to one validation envelope', () => {
    const result = run(
      '--json',
      'document',
      'propose-update',
      '11111111-1111-4111-8111-111111111111',
      '--period-start',
      '2026-05-01',
      '--period-end',
      '2026-01-01',
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(result.stderr).toBe('');
  }, CLI_TEST_TIMEOUT_MS);

  it('documents the minimal invitation commands', () => {
    const invitationHelp = run('invitation', '--help');
    expect(invitationHelp.status).toBe(0);
    expect(invitationHelp.stdout).toContain('create');
    expect(invitationHelp.stdout).toContain('list');
    expect(invitationHelp.stdout).toContain('revoke');
  }, CLI_TEST_TIMEOUT_MS);

  it('documents the visible signers box tenant flag', () => {
    const settingsHelp = run('tenant-settings', 'set', '--help');
    expect(settingsHelp.status).toBe(0);
    expect(settingsHelp.stdout).toContain('--signature-box-enabled <value>');
  }, CLI_TEST_TIMEOUT_MS);

  it('documents document type management verbs and validates required labels', () => {
    const help = run('document-type', '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('list');
    expect(help.stdout).toContain('add');
    expect(help.stdout).toContain('rename');
    expect(help.stdout).toContain('remove');
    expect(help.stdout).toContain('hide');
    expect(help.stdout).toContain('unhide');

    const missingLabel = run('--json', 'document-type', 'add');
    expect(missingLabel.status).toBe(2);
    expect(JSON.parse(missingLabel.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  }, CLI_TEST_TIMEOUT_MS);

  it('documents hidden filter value verbs and validates the kind', () => {
    const help = run('filter-value', '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('list');
    expect(help.stdout).toContain('hide');
    expect(help.stdout).toContain('unhide');

    const badKind = run('--json', 'filter-value', 'hide', '--kind', 'company', 'Jan Kowalski');
    expect(badKind.status).toBe(2);
    expect(JSON.parse(badKind.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });

    const missingKind = run('--json', 'filter-value', 'unhide', 'Jan Kowalski');
    expect(missingKind.status).toBe(2);
    expect(JSON.parse(missingKind.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
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

describe('document link batch', () => {
  it('fans out the multi-id form and reports every pair through the API contract', async () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const firstId = '22222222-2222-4222-8222-222222222222';
    const secondId = '33333333-3333-4333-8333-333333333333';
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const documentId = String(input).split('/').at(-2);
      if (documentId === secondId) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'not_found', message: 'Document not found' },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            link: {
              linkId: '44444444-4444-4444-8444-444444444444',
              label: 'podstawa',
              draft: true,
              document: {
                id: targetId,
                tenantId: 'tenant-default',
                title: 'Umowa ramowa',
                docType: 'umowa-uod',
                documentDate: '2026-08-16',
                periodStart: null,
                periodEnd: null,
                person: null,
                tags: [],
                createdAt: '2026-08-16T10:00:00.000Z',
                updatedAt: '2026-08-16T10:00:00.000Z',
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });

    const result = await linkDocumentsToTarget(
      api,
      targetId,
      [firstId, secondId],
      'podstawa',
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'not_found',
        details: {
          targetId,
          outcomes: [
            { documentId: firstId, status: 'linked', targetId, link: { draft: true } },
            {
              documentId: secondId,
              error: { code: 'not_found' },
              status: 'failed',
              targetId,
            },
          ],
        },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      `https://archive.example/api/documents/${firstId}/links`,
      `https://archive.example/api/documents/${secondId}/links`,
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ otherDocumentId: targetId, label: 'podstawa' }),
    });
  });
});

describe('document verify-seal', () => {
  it('maps verifier failures through the CLI taxonomy', () => {
    expect(verifySealBytes(new TextEncoder().encode('%PDF-1.7'))).toMatchObject({
      ok: false,
      error: { code: 'validation', message: expect.stringContaining('could not be verified') },
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

describe('document show comments', () => {
  it('collects every paginated comment for show output', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const first = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: 'tenant-default',
      documentId,
      author: { accountId: 'user-owner', name: 'Owner' },
      body: 'Pierwszy',
      draft: true,
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    const second = {
      ...first,
      id: '33333333-3333-4333-8333-333333333333',
      body: 'Drugi',
    };
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            data: String(input).includes('cursor=next')
              ? { items: [second], nextCursor: null }
              : { items: [first], nextCursor: 'next' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(listAllDocumentComments(api, documentId)).resolves.toEqual({
      ok: true,
      value: { items: [first, second], nextCursor: null },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
