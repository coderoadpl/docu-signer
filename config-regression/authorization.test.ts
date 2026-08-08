import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural authz guard (architecture.md §Authorization): a new tenant-scoped
 * use-case must not silently skip the default-deny predicate. This is a regex
 * scan over the use-case sources, not a call-graph — honest limits:
 *   - "tenant-scoped" = an exported `const` use-case whose first parameter is
 *     `ctx: Ctx`; a use-case shaped differently escapes detection.
 *   - it proves the `authorize`/`authorizeTenant` identifier appears in the
 *     function body, NOT that the call precedes repository access — that
 *     ordering stays a REVIEW+AI lever.
 * An intentional authentication-only use-case (a self-scoped read that carries
 * no capability) is a named, reasoned allowlist entry, never a silent omission.
 */

const usecasesDir = join(import.meta.dirname, '..', 'core', 'server', 'usecases');

const AUTH_ONLY: Record<string, string> = {
  listMyTenants:
    'self-scoped read of the caller-own staff memberships — authentication is the control, no capability',
};

const HELPER_CALL = /\bauthorize(?:Tenant)?\s*\(/;
const CTX_FIRST = /=\s*async\s*\(\s*ctx:\s*Ctx\b/;
const EXPORTED_CONST = /export const (\w+)\s*=/g;

interface UseCase {
  name: string;
  file: string;
  body: string;
}

const collectUseCases = (): UseCase[] => {
  const cases: UseCase[] = [];
  for (const file of readdirSync(usecasesDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(join(usecasesDir, file), 'utf8');
    const marks = [...source.matchAll(EXPORTED_CONST)].map((match) => ({
      name: match[1] ?? '',
      index: match.index ?? 0,
    }));
    marks.forEach((mark, i) => {
      const next = marks[i + 1];
      const end = next ? next.index : source.length;
      cases.push({ name: mark.name, file, body: source.slice(mark.index, end) });
    });
  }
  return cases;
};

const tenantScoped = collectUseCases().filter((useCase) => CTX_FIRST.test(useCase.body));

describe('authorization structural guard', () => {
  it('finds the known tenant-scoped use-cases (guards against a broken, vacuous scan)', () => {
    const names = new Set(tenantScoped.map((useCase) => useCase.name));
    for (const known of [
      'listTodos',
      'addTodo',
      'listCards',
      'addCard',
      'moveCard',
      'createTenant',
      'listMyTenants',
      'listStaff',
      'grantAdmin',
      'revokeAdmin',
    ]) {
      expect(names.has(known)).toBe(true);
    }
  });

  it('every tenant-scoped use-case authorizes, unless it is a named authentication-only exception', () => {
    const offenders = tenantScoped
      .filter((useCase) => !(useCase.name in AUTH_ONLY) && !HELPER_CALL.test(useCase.body))
      .map((useCase) => `${useCase.file}:${useCase.name}`);
    expect(offenders).toEqual([]);
  });

  it('the authentication-only allowlist has no stale entries', () => {
    const names = new Set(tenantScoped.map((useCase) => useCase.name));
    const stale = Object.keys(AUTH_ONLY).filter((name) => !names.has(name));
    expect(stale).toEqual([]);
  });
});
