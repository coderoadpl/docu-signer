import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural probe for the C1 atomicity contract (§Transactions): every entry on
 * the doc's MUST-ATOMIC list must map to exactly ONE port method in
 * core/server/ports.ts. If a future edit splits a MUST-ATOMIC operation back into
 * a two-call pair (the exact regression C1 forbids), the named single method
 * disappears and this probe fails — the doc can no longer promise atomicity the
 * port shape does not enforce.
 */

const demoRoot = join(import.meta.dirname, '..');
const architecture = readFileSync(join(demoRoot, '..', 'docs', 'architecture.md'), 'utf8');
const portsSource = readFileSync(join(demoRoot, 'core', 'server', 'ports.ts'), 'utf8');

const mustAtomicEntries = (): { interfaceName: string; method: string }[] => {
  const block = /<!-- MUST-ATOMIC:begin -->([\s\S]*?)<!-- MUST-ATOMIC:end -->/.exec(architecture);
  if (!block || block[1] === undefined) throw new Error('MUST-ATOMIC block not found in architecture.md');
  const entries: { interfaceName: string; method: string }[] = [];
  for (const match of block[1].matchAll(/`([A-Z][A-Za-z0-9]+)\.([a-zA-Z0-9]+)`/g)) {
    const interfaceName = match[1];
    const method = match[2];
    if (interfaceName !== undefined && method !== undefined) entries.push({ interfaceName, method });
  }
  return entries;
};

const methodBodyOf = (interfaceName: string): string => {
  const start = portsSource.indexOf(`export interface ${interfaceName} {`);
  if (start < 0) throw new Error(`interface ${interfaceName} not found in ports.ts`);
  const from = portsSource.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < portsSource.length; i += 1) {
    const ch = portsSource[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return portsSource.slice(from + 1, i);
    }
  }
  throw new Error(`unterminated interface ${interfaceName}`);
};

describe('MUST-ATOMIC list maps to single-method port operations', () => {
  const entries = mustAtomicEntries();

  it('lists at least the tenant-with-owner and last-owner-safe-revoke operations', () => {
    const methods = entries.map((entry) => `${entry.interfaceName}.${entry.method}`);
    expect(methods).toContain('TenantRepository.createTenantWithOwner');
    expect(methods).toContain('StaffRepository.revokeLastOwnerSafe');
  });

  it.each(mustAtomicEntries())(
    'each entry ($interfaceName.$method) is exactly one method on its port interface',
    ({ interfaceName, method }) => {
      const body = methodBodyOf(interfaceName);
      const occurrences = body.split(`${method}(`).length - 1;
      expect(occurrences).toBe(1);
    },
  );
});
