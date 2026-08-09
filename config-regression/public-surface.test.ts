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
const publicUseCase = read('core', 'server', 'usecases', 'public.ts');
const documentUseCases = read('core', 'server', 'usecases', 'documents.ts');

/**
 * The surviving identity-bearing surface a public handler must never reach:
 * every tenant-scoped document use-case plus identity/authorization primitives.
 * The existence probe below prevents deleted names from making this scan vacuous.
 */
const TENANT_SCOPED_USE_CASES = [
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

const IDENTITY_BEARING = [
  ...TENANT_SCOPED_USE_CASES,
  'resolveIdentity',
  'authorize',
  'authorizeTenant',
];

describe('public routes sit before identity resolution and never authorize (US-028 AC)', () => {
  it('guards the complete surviving tenant-scoped document surface', () => {
    for (const name of TENANT_SCOPED_USE_CASES) {
      expect(documentUseCases).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it('the public handler references no identity-bearing use-case or authz primitive', () => {
    const reached = IDENTITY_BEARING.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(publicAppCode),
    );
    expect(reached).toEqual([]);
  });

  it('the public handler calls the dedicated public use-case', () => {
    expect(publicAppCode).toMatch(/\bgetPublicTenantProfile\b/);
  });

  it('the public use-case takes no `ctx: Ctx` (it carries no identity)', () => {
    expect(publicUseCase).not.toMatch(/ctx:\s*Ctx/);
    expect(publicUseCase).toMatch(/getPublicTenantProfile\s*=\s*async\s*\(\s*\n?\s*input:/);
  });
});

describe('CORS is opened on the public group only (§Security baseline)', () => {
  it('the public app mounts hono/cors', () => {
    expect(publicApp).toMatch(/hono\/cors/);
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
