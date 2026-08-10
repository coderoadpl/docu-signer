import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guards for the public contract group (US-028, §Public surface,
 * §Authorization, §HTTP caching). Regex/text scans over the real sources — honest
 * limits noted at each probe — so a future edit that silently erases a stance
 * fails `pnpm run check` rather than shipping.
 */

const demoRoot = join(import.meta.dirname, '..');
const read = (...parts: string[]): string => readFileSync(join(demoRoot, ...parts), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const publicApp = read('apps', 'server', 'src', 'public-app.ts');
const publicAppCode = stripComments(publicApp);
const mainAppCode = stripComments(read('apps', 'server', 'src', 'app.ts'));
const publicUseCase = read('core', 'server', 'usecases', 'public.ts');
const documentUseCases = read('core', 'server', 'usecases', 'documents.ts');
const invitationUseCases = read('core', 'server', 'usecases', 'invitations.ts');

/**
 * The surviving identity-bearing surface a public handler must never reach:
 * tenant-scoped document/invitation use-cases plus identity/authz primitives.
 * The existence probes below prevent deleted names from making this scan vacuous.
 */
const TENANT_SCOPED_DOCUMENT_USE_CASES = [
  'createDocument',
  'listDocuments',
  'getDocument',
  'updateDocument',
  'deleteDocument',
  'requestFileUpload',
  'finalizeFileUpload',
  'serverUpload',
  'removeFile',
  'getFileContent',
  'getFileExport',
  'exportDocuments',
];

const TENANT_SCOPED_INVITATION_USE_CASES = [
  'createInvitation',
  'listInvitations',
  'revokeInvitation',
];

const TENANT_SCOPED_USE_CASES = [
  ...TENANT_SCOPED_DOCUMENT_USE_CASES,
  ...TENANT_SCOPED_INVITATION_USE_CASES,
];

const IDENTITY_BEARING = [
  ...TENANT_SCOPED_USE_CASES,
  'resolveIdentity',
  'authorize',
  'authorizeTenant',
];

describe('public routes sit before identity resolution and never authorize (US-028 AC)', () => {
  it('guards the complete surviving tenant-scoped document and invitation surfaces', () => {
    for (const name of TENANT_SCOPED_DOCUMENT_USE_CASES) {
      expect(documentUseCases).toMatch(new RegExp(`export const ${name}\\b`));
    }
    for (const name of TENANT_SCOPED_INVITATION_USE_CASES) {
      expect(invitationUseCases).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it('the public handler references no identity-bearing use-case or authz primitive', () => {
    const reached = IDENTITY_BEARING.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(publicAppCode),
    );
    expect(reached).toEqual([]);
  });

  it('the public handler calls only the dedicated identity-free use-cases', () => {
    for (const name of ['getPublicTenantProfile', 'getInvitation', 'acceptInvitation']) {
      expect(publicAppCode).toMatch(new RegExp(`await ${name}\\(`));
    }
  });

  it('the public use-cases take no `ctx: Ctx` (they carry no identity)', () => {
    expect(publicUseCase).not.toMatch(/ctx:\s*Ctx/);
    expect(publicUseCase).toMatch(/getPublicTenantProfile\s*=\s*async\s*\(\s*\n?\s*input:/);
    expect(invitationUseCases).toMatch(/getInvitation\s*=\s*async\s*\(\s*\n?\s*token:/);
    expect(invitationUseCases).toMatch(/acceptInvitation\s*=\s*async\s*\(\s*\n?\s*token:/);
  });

  it('owns both invitation routes instead of bypassing public-app', () => {
    expect(publicAppCode).toMatch(/app\.get\(PUBLIC_API_ROUTES\.invitation\.path/);
    expect(publicAppCode).toMatch(/app\.post\(PUBLIC_API_ROUTES\.invitationAccept\.path/);
    expect(mainAppCode).not.toMatch(/PUBLIC_API_ROUTES\.invitation/);
  });
});

describe('CORS is opened on the public group only (§Security baseline)', () => {
  it('the public app mounts hono/cors', () => {
    expect(publicApp).toMatch(/hono\/cors/);
    expect(publicAppCode).toMatch(/allowMethods:\s*\['GET',\s*'POST'\]/);
  });

  it('the authenticated app never imports a CORS middleware', () => {
    expect(read('apps', 'server', 'src', 'app.ts')).not.toMatch(/hono\/cors/);
  });
});

const walkTs = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkTs(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
};

describe('the public Cache-Control lives in exactly one helper (§HTTP caching)', () => {
  it('no non-test source hand-writes an s-maxage / stale-while-revalidate string', () => {
    const allowed = join(demoRoot, 'core', 'contract', 'cache.ts');
    const offenders: string[] = [];
    for (const root of ['core', 'adapters', 'apps', 'scripts']) {
      for (const file of walkTs(join(demoRoot, root))) {
        if (file === allowed) continue;
        const text = readFileSync(file, 'utf8');
        if (text.includes('s-maxage') || text.includes('stale-while-revalidate')) {
          offenders.push(relative(demoRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
