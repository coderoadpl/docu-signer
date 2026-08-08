import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Mechanical enforcement of the drizzle migration sequence (DECIDE F2): the
 * numeric prefixes on disk must be strictly increasing, gapless and
 * duplicate-free, and the `meta/_journal.json` must describe exactly those files
 * in the same order. A hand-merged or cherry-picked branch that reuses a prefix,
 * skips a number, or forgets to regenerate the journal is caught here instead of
 * failing opaquely at migrate time. Pure and directory-parameterised so the
 * config-regression probe can plant a duplicate and prove the gate still fires.
 */

const MIGRATION_FILE = /^(\d+)_[a-z0-9_]+\.sql$/;
const TAG_PREFIX = /^(\d+)_/;

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
}

const parseJournal = (raw: string): JournalEntry[] => {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('entries' in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error('journal has no entries array');
  }
  return parsed.entries.map((entry: { idx: number; tag: string }) => ({
    idx: entry.idx,
    tag: entry.tag,
  }));
};

export const lintMigrations = (drizzleDir: string): string[] => {
  const problems: string[] = [];

  if (!existsSync(drizzleDir)) return [`[migration] drizzle directory "${drizzleDir}" does not exist`];

  const sqlFiles = readdirSync(drizzleDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const prefixes: number[] = [];
  const fileByPrefix = new Map<number, string>();
  for (const file of sqlFiles) {
    const match = MIGRATION_FILE.exec(file);
    if (!match || match[1] === undefined) {
      problems.push(`[migration] "${file}" does not match the <NNNN>_<name>.sql convention.`);
      continue;
    }
    const prefix = Number(match[1]);
    const existing = fileByPrefix.get(prefix);
    if (existing !== undefined) {
      problems.push(
        `[migration] duplicate numeric prefix ${match[1]} — "${existing}" and "${file}" collide.`,
      );
      continue;
    }
    fileByPrefix.set(prefix, file);
    prefixes.push(prefix);
  }

  const ordered = [...prefixes].sort((a, b) => a - b);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index] !== index) {
      problems.push(
        `[migration] non-contiguous sequence: expected ${String(index).padStart(4, '0')} but the ` +
          `${index}-th migration is ${String(ordered[index]).padStart(4, '0')} — prefixes must be ` +
          `gapless and start at 0000.`,
      );
      break;
    }
  }

  const journalPath = join(drizzleDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    problems.push(`[migration] "${journalPath}" is missing — regenerate with drizzle-kit.`);
    return problems;
  }

  let entries: JournalEntry[];
  try {
    entries = parseJournal(readFileSync(journalPath, 'utf8'));
  } catch (cause) {
    problems.push(`[migration] could not parse meta/_journal.json: ${String(cause)}`);
    return problems;
  }

  const journalTags = new Set(entries.map((entry) => entry.tag));
  const fileTags = new Set(sqlFiles.map((file) => file.replace(/\.sql$/, '')));
  for (const tag of journalTags) {
    if (!fileTags.has(tag)) {
      problems.push(`[migration] journal references "${tag}" but ${tag}.sql is not on disk.`);
    }
  }
  for (const tag of fileTags) {
    if (!journalTags.has(tag)) {
      problems.push(`[migration] ${tag}.sql is on disk but the journal has no entry for it.`);
    }
  }

  const byIdx = [...entries].sort((a, b) => a.idx - b.idx);
  for (let index = 0; index < byIdx.length; index += 1) {
    const entry = byIdx[index];
    if (entry === undefined) continue;
    if (entry.idx !== index) {
      problems.push(
        `[migration] journal idx sequence is not gapless: entry ${index} has idx ${entry.idx}.`,
      );
      break;
    }
    const tagPrefix = TAG_PREFIX.exec(entry.tag)?.[1];
    if (tagPrefix !== undefined && Number(tagPrefix) !== entry.idx) {
      problems.push(
        `[migration] journal entry "${entry.tag}" has idx ${entry.idx} but its filename prefix is ${tagPrefix}.`,
      );
    }
  }

  return problems;
};
