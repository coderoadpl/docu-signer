import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lintMigrations } from '../scripts/migration-lint.js';

/**
 * Behavioral probe for the migration-sequence gate (DECIDE F2): plant a broken
 * drizzle directory and prove `lintMigrations` — the check `pnpm run doc-lint`
 * runs — still REJECTS it, so a silently-weakened sequence fails CI. The real
 * `drizzle/` must stay clean; every fixture lives in its own temp dir.
 */

let base: string;

const journal = (tags: string[]): string =>
  JSON.stringify({
    version: '7',
    dialect: 'postgresql',
    entries: tags.map((tag, idx) => ({ idx, version: '7', when: idx, tag, breakpoints: true })),
  });

const plant = (name: string, files: Record<string, string>): string => {
  const dir = join(base, name);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
  return dir;
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'migration-lint-probe-'));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('migration-sequence gate still rejects violations', () => {
  it('accepts a clean, gapless sequence that matches the journal', () => {
    const dir = plant('clean', {
      '0000_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
      'meta/_journal.json': journal(['0000_first', '0001_second']),
    });
    expect(lintMigrations(dir)).toEqual([]);
  });

  it('rejects a duplicate numeric prefix', () => {
    const dir = plant('duplicate', {
      '0000_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
      '0001_second_dupe.sql': 'SELECT 3;',
      'meta/_journal.json': journal(['0000_first', '0001_second', '0001_second_dupe']),
    });
    const problems = lintMigrations(dir);
    expect(problems.some((p) => p.includes('duplicate numeric prefix 0001'))).toBe(true);
  });

  it('rejects a gap in the sequence', () => {
    const dir = plant('gap', {
      '0000_first.sql': 'SELECT 1;',
      '0002_third.sql': 'SELECT 2;',
      'meta/_journal.json': journal(['0000_first', '0002_third']),
    });
    const problems = lintMigrations(dir);
    expect(problems.some((p) => p.includes('non-contiguous sequence'))).toBe(true);
  });

  it('rejects a migration file missing from the journal', () => {
    const dir = plant('orphan-file', {
      '0000_first.sql': 'SELECT 1;',
      '0001_second.sql': 'SELECT 2;',
      'meta/_journal.json': journal(['0000_first']),
    });
    const problems = lintMigrations(dir);
    expect(problems.some((p) => p.includes('0001_second.sql is on disk but the journal'))).toBe(true);
  });

  it('rejects a journal entry with no file on disk', () => {
    const dir = plant('orphan-journal', {
      '0000_first.sql': 'SELECT 1;',
      'meta/_journal.json': journal(['0000_first', '0001_ghost']),
    });
    const problems = lintMigrations(dir);
    expect(problems.some((p) => p.includes('0001_ghost.sql is not on disk'))).toBe(true);
  });
});
