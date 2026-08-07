import { configDefaults, defineConfig } from 'vitest/config';

// Integration tests hit a real Postgres and are opt-in: the default `vitest run`
// (npm run test / test:coverage) must stay database-free for the CI check job.
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
      ],
      // Ratchet floor, not aspiration: each threshold is the measured coverage
      // of the default (database-free) `vitest run --coverage` on 2026-07-17
      // (stmts/lines 62.13, branches 89.51, funcs 80.12), rounded DOWN to the
      // whole percent. A regression below the floor fails `npm run check`;
      // raise the floor whenever coverage climbs. Integration-only files
      // (repositories.ts, migrate.ts, …) read 0% here because they are covered
      // by `test:integration`, which runs where Postgres exists (CI smoke job).
      thresholds: {
        statements: 62,
        branches: 89,
        functions: 80,
        lines: 62,
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
          include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
          setupFiles: ['apps/web/src/test/setup.ts'],
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
                include: ['adapters/**/*.integration.test.ts'],
              },
            },
          ]
        : []),
    ],
  },
});
