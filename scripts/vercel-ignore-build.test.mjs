import { describe, expect, it } from 'vitest';

import { shouldBuild } from './vercel-ignore-build.mjs';

describe('shouldBuild', () => {
  it('always builds production', () => {
    expect(shouldBuild({ VERCEL_ENV: 'production' }, ['docs/runbook.md'])).toBe(true);
  });

  it('builds staging', () => {
    expect(shouldBuild({ VERCEL_GIT_COMMIT_REF: 'staging' }, ['docs/runbook.md'])).toBe(true);
  });

  it('skips a branch without an open pull request', () => {
    expect(shouldBuild({}, ['apps/web/src/main.tsx'])).toBe(false);
  });

  it('skips a docs-only pull request commit', () => {
    expect(
      shouldBuild({ VERCEL_GIT_PULL_REQUEST_ID: '42' }, ['README.md', 'docs/runbook.png']),
    ).toBe(false);
  });

  it('builds a source change', () => {
    expect(
      shouldBuild({ VERCEL_GIT_PULL_REQUEST_ID: '42' }, ['apps/web/src/main.tsx']),
    ).toBe(true);
  });

  it('builds a migration change', () => {
    expect(shouldBuild({ VERCEL_GIT_PULL_REQUEST_ID: '42' }, ['drizzle/0026_wave.sql'])).toBe(
      true,
    );
  });

  it('builds when git diff fails', () => {
    expect(shouldBuild({ VERCEL_GIT_PULL_REQUEST_ID: '42' }, null)).toBe(true);
  });
});
