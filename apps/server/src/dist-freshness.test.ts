import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { distFreshnessWarning } from './dist-freshness.js';

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-freshness-'));
  dirs.push(dir);
  return dir;
};

const writeAt = (path: string, epochSeconds: number): void => {
  writeFileSync(path, 'x', 'utf8');
  utimesSync(path, epochSeconds, epochSeconds);
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('distFreshnessWarning', () => {
  it('reports a missing bundle and points at dev:web', () => {
    const warning = distFreshnessWarning(join(scratch(), 'dist/web'), scratch());
    expect(warning).toContain('no built bundle');
    expect(warning).toContain('dev:web');
  });

  it('flags a dist older than the sources', () => {
    const repo = scratch();
    const dist = join(repo, 'dist/web');
    mkdirSync(dist, { recursive: true });
    mkdirSync(join(repo, 'core/contract'), { recursive: true });
    writeAt(join(dist, 'index.html'), 1_000_000);
    writeAt(join(repo, 'core/contract/routes.ts'), 2_000_000);
    const warning = distFreshnessWarning(dist, repo);
    expect(warning).toContain('STALE BUNDLE');
    expect(warning).toContain('build:web');
  });

  it('stays silent when the bundle is newer than every source', () => {
    const repo = scratch();
    const dist = join(repo, 'dist/web');
    mkdirSync(dist, { recursive: true });
    mkdirSync(join(repo, 'apps/web/src'), { recursive: true });
    writeAt(join(repo, 'apps/web/src/main.tsx'), 1_000_000);
    writeAt(join(dist, 'index.html'), 2_000_000);
    expect(distFreshnessWarning(dist, repo)).toBeNull();
  });
});
