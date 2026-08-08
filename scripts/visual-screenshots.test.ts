import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectFiles, screenshotsFrom } from './visual-screenshots.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8p2AAAAAElFTkSuQmCC';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'visual-screenshots-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const writePng = (path: string): void => {
  writeFileSync(path, png, 'base64');
};

describe('visual screenshot artifacts', () => {
  it('collects allowed names and builds sorted complete screenshot groups', () => {
    const nested = join(sandbox, 'nested');
    mkdirSync(nested);
    for (const stem of ['zeta', 'alpha']) {
      for (const kind of ['expected', 'actual', 'diff']) {
        writePng(join(nested, `${stem}-${kind}.png`));
      }
    }
    writePng(join(nested, 'incomplete-expected.png'));

    const files = collectFiles(sandbox);

    expect([...files.keys()].sort()).toEqual([
      'alpha-actual.png',
      'alpha-diff.png',
      'alpha-expected.png',
      'incomplete-expected.png',
      'zeta-actual.png',
      'zeta-diff.png',
      'zeta-expected.png',
    ]);
    expect(screenshotsFrom(files)).toEqual([
      {
        stem: 'alpha',
        files: {
          expected: join(nested, 'alpha-expected.png'),
          actual: join(nested, 'alpha-actual.png'),
          diff: join(nested, 'alpha-diff.png'),
        },
        pixels: 'pixel count unavailable',
      },
      {
        stem: 'zeta',
        files: {
          expected: join(nested, 'zeta-expected.png'),
          actual: join(nested, 'zeta-actual.png'),
          diff: join(nested, 'zeta-diff.png'),
        },
        pixels: 'pixel count unavailable',
      },
    ]);
  });

  it('rejects disallowed and path-traversal names', () => {
    writePng(join(sandbox, 'space name-expected.png'));
    writePng(join(sandbox, 'artifact-expected.png.exe'));

    expect(collectFiles(sandbox).size).toBe(0);
    expect(
      screenshotsFrom(
        new Map([
          ['../escape-expected.png', '/tmp/escape-expected.png'],
          ['nested/escape-actual.png', '/tmp/escape-actual.png'],
          ['escape-diff.png.exe', '/tmp/escape-diff.png'],
        ]),
      ),
    ).toEqual([]);
  });

  it('rejects duplicate flattened names', () => {
    const first = join(sandbox, 'first');
    const second = join(sandbox, 'second');
    mkdirSync(first);
    mkdirSync(second);
    writePng(join(first, 'same-expected.png'));
    writePng(join(second, 'same-expected.png'));

    expect(() => collectFiles(sandbox)).toThrow(
      'Duplicate flattened artifact name: same-expected.png',
    );
  });

  it('returns no screenshots for an empty or missing directory', () => {
    expect(collectFiles(sandbox)).toEqual(new Map());
    expect(collectFiles(join(sandbox, 'missing'))).toEqual(new Map());
    expect(screenshotsFrom(collectFiles(sandbox))).toEqual([]);
  });
});
