import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

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
  });

  it('maps an unknown removed command to the validation exit code', () => {
    const result = run('--json', 'todo', 'list');
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});
