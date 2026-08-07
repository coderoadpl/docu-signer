import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against the stale-bundle failure class (incident 2026-07-12): the
 * node server serves whatever `dist/web` holds, so a bundle built before a
 * contract change keeps shipping the OLD contract and every response fails
 * schema parsing with a misleading "does not match the contract" error.
 * The build is gitignored, so git looks clean while the app is broken.
 */

export const newestMtimeMs = (dir: string): number => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
};

const SOURCE_ROOTS = ['apps/web/src', 'core/contract', 'core/client', 'core/domain'];

export const distFreshnessWarning = (webDistDir: string, repoRoot: string): string | null => {
  if (!existsSync(join(webDistDir, 'index.html'))) {
    return (
      `WEB_DIST_DIR (${webDistDir}) has no built bundle. ` +
      'The canonical dev flow for frontend work is `npm run dev:web` (Vite, hot reload); ' +
      'to serve a real bundle from this server, run `npm run build:web` first.'
    );
  }
  const sourceRoots = SOURCE_ROOTS.map((root) => join(repoRoot, root)).filter(existsSync);
  if (sourceRoots.length === 0) return null;
  const newestSource = Math.max(...sourceRoots.map(newestMtimeMs));
  const newestDist = newestMtimeMs(webDistDir);
  if (newestSource <= newestDist) return null;
  const behindMinutes = Math.round((newestSource - newestDist) / 60000);
  return (
    `STALE BUNDLE: ${webDistDir} is older than the web/contract sources ` +
    `(newest source change is ~${behindMinutes} min newer than the build). ` +
    'You are serving an OUT-OF-DATE frontend — if the contract changed, every page ' +
    'will fail with "response does not match the contract". ' +
    'Run `npm run build:web`, or do frontend work through `npm run dev:web` instead.'
  );
};

export const warnIfDistStale = (webDistDir: string, repoRoot: string): void => {
  try {
    const warning = distFreshnessWarning(webDistDir, repoRoot);
    if (warning !== null) {
      process.stderr.write(`\n!!! ${warning}\n\n`);
    }
  } catch {
    // A freshness check must never stop the server from booting.
  }
};
