import { configDefaults, defineConfig } from 'vitest/config';

// Integration tests hit a real Postgres and are opt-in: the default `vitest run`
// (pnpm run test / test:coverage) must stay database-free for the CI check job.
// Enabling `VITEST_INTEGRATION=1` adds the `integration` project; the `node`
// project always excludes *.integration.test.ts so they never leak into a
// default run (they still match the `**/*.test.ts` glob).
const integrationEnabled = process.env['VITEST_INTEGRATION'] === '1';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: [
        'core/**/*.ts',
        'core/**/*.tsx',
        'adapters/**/*.ts',
        'adapters/**/*.tsx',
        'apps/**/*.ts',
        'apps/**/*.tsx',
        'scripts/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        'apps/web/src/main.tsx',
        'adapters/db/auth-schema.ts',
        'drizzle/**',
        'eslint-plugin-agentproofarch/**',
        // e2e-only orchestration (drop/create/migrate/seed a throwaway DB, boot
        // the real server): it has no database-free unit surface and is exercised
        // by the `e2e` CI job's real browser, so counting it as 0% would falsely
        // depress the database-free ratchet floor below.
        'scripts/e2e-server.ts',
        // Smoke-gate orchestration, same rationale: these boot the real server /
        // drive a real deploy through the CLI (`pnpm run smoke`, `smoke:remote`),
        // so they have no database-free unit surface and are exercised by the
        // smoke CI job — counting them as 0% would falsely depress the floor.
        'scripts/smoke.ts',
        'scripts/smoke-cli.ts',
        'scripts/smoke-remote.ts',
        'scripts/server-harness.ts',
        // Gate-adjacent orchestration too: it shells out to `docker ps` and
        // process.exit()s, so it has no database-free unit surface either.
        'scripts/db-up-preflight.ts',
        // Mailpit HTTP-API client used by the smoke/e2e harness (recover the
        // captured magic link): a network helper with no database-free unit
        // surface, exercised by the smoke + e2e CI jobs — excluded for the same
        // reason as the smoke/e2e scripts above.
        'scripts/mailpit.ts',
        // CI-only programs with GitHub API, git, or filesystem side effects.
        'scripts/visual-report.ts',
        'scripts/visual-verdict-input.ts',
        // Nightly backup orchestration talks to Drive, Blob, and pg_dump; its
        // deterministic manifest, retention, naming, and guard logic lives in
        // backup-logic.ts and is covered without network credentials.
        'scripts/backup.ts',
        // doc-lint is a check-gate orchestration script (a top-level program that
        // scans docs/config and process.exit()s), run by `pnpm run doc-lint`
        // inside `pnpm run check`, not by vitest. Like the smoke/e2e scripts above
        // it has no database-free unit surface, so counting it as 0% would
        // falsely depress the branch floor.
        'scripts/doc-lint.ts',
      ],
      // Ratchet floor, not aspiration: each threshold is the measured coverage
      // of the default (database-free) `vitest run --coverage`, rounded DOWN to
      // the whole percent. A regression below the floor fails `pnpm run check`;
      // raise the floor whenever coverage climbs. Integration-only files
      // (repositories.ts, cards-repository.ts, migrate.ts, …) read 0% here
      // because they are covered by `test:integration`, which runs where
      // Postgres exists (CI smoke job).
      //
      // Re-measured 2026-08-02 after merging password parity, saved search
      // presets, and detail cleanup: 81.48/87.29/80.46/81.48, rounded down.
      thresholds: {
        statements: 81,
        branches: 87,
        functions: 80,
        lines: 81,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'core/**/*.test.ts',
            'core/**/*.test.tsx',
            'adapters/**/*.test.ts',
            'adapters/**/*.test.tsx',
            'apps/cli/**/*.test.ts',
            'apps/cli/**/*.test.tsx',
            'apps/server/**/*.test.ts',
            'apps/server/**/*.test.tsx',
            'scripts/**/*.test.ts',
            'eslint-plugin-agentproofarch/**/*.test.js',
          ],
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          testTimeout: 15_000,
          include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
          exclude: [...configDefaults.exclude],
          setupFiles: [
            'apps/web/src/test/pointer-events.ts',
            'apps/web/src/test/setup.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'config',
          environment: 'node',
          include: ['config-regression/**/*.test.ts'],
        },
      },
      ...(integrationEnabled
        ? [
            {
              extends: true as const,
              test: {
                name: 'integration',
                environment: 'node',
                include: [
                  'adapters/**/*.integration.test.ts',
                  'apps/**/*.integration.test.ts',
                  'scripts/**/*.integration.test.ts',
                ],
              },
            },
          ]
        : []),
    ],
  },
});
