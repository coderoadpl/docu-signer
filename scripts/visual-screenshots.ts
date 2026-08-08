import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export const allowedName = /^([A-Za-z0-9._-]+)-(expected|actual|diff)\.png$/;

export type Kind = 'expected' | 'actual' | 'diff';

export const kinds = ['expected', 'actual', 'diff'] as const;

export const publishedName = (kind: Kind): string => (kind === 'expected' ? 'baseline' : kind);

export interface Screenshot {
  readonly stem: string;
  readonly files: Record<Kind, string>;
  readonly pixels: string;
}

const repoRoot = join(import.meta.dirname, '..');

export const collectFiles = (root: string): Map<string, string> => {
  const files = new Map<string, string>();
  if (!existsSync(root)) return files;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile() && allowedName.test(entry.name)) {
        const name = basename(entry.name);
        if (files.has(name)) throw new Error(`Duplicate flattened artifact name: ${name}`);
        files.set(name, full);
      }
    }
  };
  visit(root);
  return files;
};

const pixelSummary = (expected: string, actual: string): string => {
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/visual-diff.mjs'), expected, actual],
    { encoding: 'utf8' },
  );
  return result.stdout.trim() || 'pixel count unavailable';
};

export const screenshotsFrom = (files: Map<string, string>): Screenshot[] => {
  const grouped = new Map<string, Partial<Record<Kind, string>>>();
  for (const [name, path] of files) {
    const match = allowedName.exec(name);
    const stem = match?.[1];
    const kind = kinds.find((candidate) => candidate === match?.[2]);
    if (stem === undefined || kind === undefined) continue;
    grouped.set(stem, { ...grouped.get(stem), [kind]: path });
  }

  const screenshots: Screenshot[] = [];
  for (const [stem, group] of grouped) {
    if (!group.expected || !group.actual || !group.diff) continue;
    screenshots.push({
      stem,
      files: { expected: group.expected, actual: group.actual, diff: group.diff },
      pixels: pixelSummary(group.expected, group.actual),
    });
  }
  return screenshots.sort((left, right) => left.stem.localeCompare(right.stem));
};
