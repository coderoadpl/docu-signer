import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { probeSignInCookies } from '#adapters/auth/client-adapter.js';
import { EXIT_CODE_BY_ERROR_CODE, publicCacheControl } from '#core/contract/index.js';

import { fetchMagicLink, fetchPasswordResetLink } from './mailpit.js';
import {
  assertHealthAttestation,
  assertSmoke,
  SmokeFailure,
  type AttestedSmokeTarget,
} from './smoke-target.js';

export { SmokeFailure };

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const tsxBin = join(rootDir, 'node_modules/.bin/tsx');

export const fail = (message: string): never => {
  throw new SmokeFailure(message);
};

export function assert(condition: boolean, message: string): asserts condition {
  assertSmoke(condition, message);
}

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export const run = (
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string = rootDir,
): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) =>
      resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }),
    );
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const envelope = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
const healthSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('up'),
  version: z.string(),
  sha: z.string(),
});
const meSchema = z.object({
  email: z.string(),
  tenant: z.object({ slug: z.string(), staffRole: z.string() }).nullable(),
});
const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  files: z.array(z.object({ id: z.uuid(), fileName: z.string() })).optional(),
});
const documentsSchema = z.object({ documents: z.array(documentSchema) });
const documentWriteSchema = z.object({ document: documentSchema });
const fileWriteSchema = z.object({
  file: z.object({ id: z.uuid(), fileName: z.string() }),
});
const exportSchema = z.object({
  path: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().positive(),
});
const discoverySchema = z.object({ slug: z.string(), contentVersion: z.string() });
const profileSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  contentVersion: z.string(),
});
const passwordResetRequestSchema = z.object({ requested: z.literal(true), email: z.string() });

const readEnvelope = (result: Run, label: string) => {
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return fail(
      `${label}: stdout was not JSON.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return envelope.parse(raw);
};

const expectOk = (result: Run, label: string): unknown => {
  assert(
    result.code === 0,
    `${label}: expected exit 0, got ${String(result.code)}.\n${result.stdout}${result.stderr}`,
  );
  const parsed = readEnvelope(result, label);
  assert(parsed.ok, `${label}: expected an ok envelope`);
  return parsed.data;
};

const expectError = (
  result: Run,
  label: string,
  exitCode: number,
  errorCode: string,
): void => {
  assert(
    result.code === exitCode,
    `${label}: expected exit ${String(exitCode)}, got ${String(result.code)}.\n${result.stdout}${result.stderr}`,
  );
  const parsed = readEnvelope(result, label);
  assert(!parsed.ok, `${label}: expected an error envelope`);
  assert(
    parsed.error.code === errorCode,
    `${label}: expected ${errorCode}, got ${parsed.error.code}`,
  );
};

export interface SmokeTarget extends AttestedSmokeTarget {
  mailpitApiUrl?: string;
}

const assertHeaders = async (baseUrl: string): Promise<void> => {
  const health = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: 'https://foreign.example' },
  });
  assert(health.headers.get('cache-control') === 'no-store', 'health must be no-store');
  assert(
    health.headers.get('x-content-type-options') === 'nosniff',
    'health must set nosniff',
  );
  assert(
    health.headers.get('content-security-policy')?.includes("script-src 'self'") === true,
    'health must set the script CSP',
  );
  assert(
    health.headers.get('access-control-allow-origin') === null,
    'authenticated API must stay CORS-closed',
  );

  const index = await fetch(`${baseUrl}/`);
  assert(index.ok, `index.html must be served, got ${String(index.status)}`);
  assert(
    index.headers.get('cache-control') === 'public, max-age=0, must-revalidate',
    'index.html must revalidate',
  );
};

const assertPublicSurface = async (baseUrl: string, tenant: string): Promise<void> => {
  const origin = 'https://foreign.example';
  const discoveryResponse = await fetch(`${baseUrl}/api/public/tenants/${tenant}`, {
    headers: { origin },
  });
  assert(discoveryResponse.status === 200, 'public discovery must be available');
  assert(
    discoveryResponse.headers.get('access-control-allow-origin') === '*',
    'public discovery must allow cross-origin reads',
  );
  if (discoveryResponse.headers.get('x-vercel-id') === null) {
    assert(
      discoveryResponse.headers.get('cache-control') === publicCacheControl('discovery'),
      'public discovery must use the shared cache policy',
    );
  }
  const discoveryEnvelope = envelope.parse(await discoveryResponse.json());
  assert(discoveryEnvelope.ok, 'public discovery must return an ok envelope');
  const discovery = discoverySchema.parse(discoveryEnvelope.data);

  const profileResponse = await fetch(
    `${baseUrl}/api/public/tenants/${tenant}/v/${discovery.contentVersion}`,
    { headers: { origin } },
  );
  assert(profileResponse.status === 200, 'public profile must be available');
  const profileEnvelope = envelope.parse(await profileResponse.json());
  assert(profileEnvelope.ok, 'public profile must return an ok envelope');
  const profile = profileSchema.parse(profileEnvelope.data);
  assert(profile.slug === tenant && profile.displayName.length > 0, 'public profile mismatch');

  const missing = await fetch(`${baseUrl}/api/public/tenants/missing-${randomUUID()}`);
  assert(missing.status === 404, 'unknown public tenant must be not_found');
  assert(missing.headers.get('cache-control') === 'no-store', 'public errors must be no-store');
};

const assertSessionCookie = async (target: SmokeTarget): Promise<void> => {
  const probe = await probeSignInCookies(target.baseUrl, {
    email: target.email,
    password: target.password,
  });
  assert(probe.ok, `cookie sign-in failed: ${String(probe.status)} ${probe.body}`);
  const cookie = probe.setCookie.find((value) => /session_token=/i.test(value));
  assert(cookie !== undefined, 'sign-in did not set a session cookie');
  const attributes = cookie.split(';').map((part) => part.trim().toLowerCase());
  assert(attributes.includes('httponly'), 'session cookie must be HttpOnly');
  assert(attributes.includes('samesite=lax'), 'session cookie must be SameSite=Lax');
  assert(
    attributes.includes('secure') === (new URL(target.baseUrl).protocol === 'https:'),
    'session cookie Secure flag must match transport',
  );
};

export const driveCli = async (target: SmokeTarget, homes: string[]): Promise<void> => {
  await assertHeaders(target.baseUrl);
  await assertPublicSurface(target.baseUrl, target.tenant);

  const authHome = mkdtempSync(join(tmpdir(), 'smoke-cli-auth-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'smoke-cli-anon-'));
  homes.push(authHome, anonHome);
  const cli = (args: string[], home = authHome): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', '--json', '--api-url', target.baseUrl, ...args], {
      HOME: home,
    });

  const health = healthSchema.parse(expectOk(await cli(['health']), 'health'));
  if (assertHealthAttestation(health.sha, target) === 'anonymous-only') return;

  await assertSessionCookie(target);
  expectOk(
    await cli([
      'login',
      '--email',
      target.email,
      '--password',
      target.password,
    ]),
    'login',
  );
  const me = meSchema.parse(expectOk(await cli(['whoami']), 'whoami'));
  assert(me.email === target.email, 'whoami returned the wrong account');
  assert(me.tenant?.slug === target.tenant, 'whoami did not resolve the archive');

  const before = documentsSchema.parse(
    expectOk(await cli(['document', 'list']), 'document list before'),
  );
  const title = `Smoke ${randomUUID()}`;
  const created = documentWriteSchema.parse(
    expectOk(
      await cli([
        'document',
        'add',
        title,
        '--type',
        'umowa-uod',
        '--date',
        '2026-08-01',
      ]),
      'document add',
    ),
  ).document;
  const after = documentsSchema.parse(
    expectOk(await cli(['document', 'list']), 'document list after'),
  );
  assert(
    after.documents.length === before.documents.length + 1,
    'document create did not add exactly one row',
  );
  assert(after.documents.some((document) => document.id === created.id), 'created document missing');

  const assetDir = mkdtempSync(join(tmpdir(), 'smoke-document-'));
  homes.push(assetDir);
  const pdfPath = join(assetDir, 'smoke.pdf');
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  writeFileSync(pdfPath, await pdf.save());
  const uploaded = fileWriteSchema.parse(
    expectOk(
      await cli([
        'document',
        'upload',
        created.id,
        pdfPath,
        '--role',
        'source',
        '--content-type',
        'application/pdf',
      ]),
      'document upload',
    ),
  );
  assert(uploaded.file.fileName === 'smoke.pdf', 'uploaded file name mismatch');

  const exportPath = join(assetDir, 'archive.zip');
  const exported = exportSchema.parse(
    expectOk(
      await cli(['document', 'export', created.id, '--output', exportPath]),
      'document export',
    ),
  );
  assert(statSync(exportPath).size === exported.sizeBytes, 'export size mismatch');

  expectError(
    await cli(['document', 'list'], anonHome),
    'anonymous document list',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );
  expectError(
    await cli(['document', 'add', 'invalid']),
    'invalid document command',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  expectError(
    await cli(['document', 'show', '00000000-0000-4000-8000-000000000000']),
    'missing document',
    EXIT_CODE_BY_ERROR_CODE.not_found,
    'not_found',
  );

  if (target.mailpitApiUrl) {
    const magicHome = mkdtempSync(join(tmpdir(), 'smoke-cli-magic-'));
    homes.push(magicHome);
    expectOk(
      await cli(['login-link', '--email', 'mag@example.com'], magicHome),
      'magic-link request',
    );
    const link = await fetchMagicLink(target.mailpitApiUrl, 'mag@example.com');
    expectOk(
      await cli(['login-link', '--email', 'mag@example.com', '--link', link], magicHome),
      'magic-link follow',
    );
    const magicMe = meSchema.parse(expectOk(await cli(['whoami'], magicHome), 'magic whoami'));
    assert(magicMe.tenant?.slug === target.tenant, 'magic-link account lacks archive access');

    const resetRequest = passwordResetRequestSchema.parse(
      expectOk(
        await cli(['account', 'request-password-reset', '--email', target.email], magicHome),
        'password reset request',
      ),
    );
    assert(resetRequest.email === target.email, 'password reset requested the wrong account');
    const resetLink = await fetchPasswordResetLink(target.mailpitApiUrl, target.email);
    assert(new URL(resetLink).pathname.includes('reset-password'), 'password reset email did not contain a reset URL');
  }

  expectOk(await cli(['document', 'remove', created.id]), 'document cleanup');
  const cleaned = documentsSchema.parse(
    expectOk(await cli(['document', 'list']), 'document list after cleanup'),
  );
  assert(
    cleaned.documents.length === before.documents.length,
    'smoke left a document behind',
  );
};
