import { defineConfig, devices } from '@playwright/test';

// The e2e gate drives a real browser over the real stack: an isolated
// `agentproofarch_e2e` database (drop/create/migrate/seed) with `localhost`
// registered as a single-tenant custom domain, serving the built web bundle
// from `entry.node.ts` — the same server production runs. Kept out of
// `npm run check` (needs a browser + Postgres); runs as its own CI job.
const PORT = 47990;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'tsx scripts/e2e-server.ts',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
