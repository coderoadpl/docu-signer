import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIPPABLE_PREFIXES = [
  'docs/',
  '.github/',
  'e2e/',
  'visual/',
  'config-regression/',
  '.claude/',
  'scripts/',
];

const isSkippablePath = (path) =>
  path.endsWith('.md') ||
  path.endsWith('.test.ts') ||
  path.endsWith('.test.tsx') ||
  SKIPPABLE_PREFIXES.some((prefix) => path.startsWith(prefix));

export const shouldBuild = (env, changedPaths) => {
  if (env.VERCEL_ENV === 'production') return true;
  if (env.VERCEL_GIT_COMMIT_REF === 'staging') return true;
  if (!env.VERCEL_GIT_PULL_REQUEST_ID) return false;
  if (changedPaths === null) return true;
  return changedPaths.some((path) => !isSkippablePath(path));
};

const readChangedPaths = () => {
  const result = spawnSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').filter(Boolean);
};

const reason = (env, changedPaths, build) => {
  if (env.VERCEL_ENV === 'production') return 'production deployment';
  if (env.VERCEL_GIT_COMMIT_REF === 'staging') return 'staging branch';
  if (!env.VERCEL_GIT_PULL_REQUEST_ID) return 'branch has no open pull request';
  if (changedPaths === null) return 'git diff failed';
  return build ? 'commit changes app paths' : 'commit changes only non-app paths';
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const needsDiff =
    process.env.VERCEL_ENV !== 'production' &&
    process.env.VERCEL_GIT_COMMIT_REF !== 'staging' &&
    Boolean(process.env.VERCEL_GIT_PULL_REQUEST_ID);
  const changedPaths = needsDiff ? readChangedPaths() : [];
  const build = shouldBuild(process.env, changedPaths);
  console.log(`Vercel build ${build ? 'required' : 'skipped'}: ${reason(process.env, changedPaths, build)}.`);
  process.exit(build ? 1 : 0);
}
