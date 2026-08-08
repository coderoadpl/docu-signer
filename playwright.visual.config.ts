import { defineConfig, devices } from '@playwright/test';

// The visual gate (ADR-0008): pixel comparison over the same boot harness the
// e2e gate uses, kept in its own suite and its own config so a moved screenshot
// can never redden the required `e2e` check. Baselines are rendered by the linux
// CI runner only — see `ignoreSnapshots` and `snapshotPathTemplate` below.
const PORT = 47990;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  // A retry that turns a screenshot green is the rerun-to-green the flake
  // doctrine bans (demo/CLAUDE.md), so the suite is not given the option.
  retries: 0,
  // Screenshot bytes follow the OS font stack and rasterizer: a mac run must not
  // be able to author or overwrite the baselines CI compares against.
  ignoreSnapshots: process.platform !== 'linux',
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixels: 0,
      // Playwright's default per-pixel tolerance is 0.2 (YIQ), so without this a
      // whole-image colour shift counts as zero differing pixels.
      threshold: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
        trace: 'retain-on-failure',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        colorScheme: 'light',
        contextOptions: { reducedMotion: 'reduce' },
        locale: 'en-US',
        timezoneId: 'UTC',
      },
    },
  ],
  webServer: {
    command: 'tsx scripts/e2e-server.ts',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
