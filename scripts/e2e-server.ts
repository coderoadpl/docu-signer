import { spawn } from 'node:child_process';
import { join } from 'node:path';

import pg from 'pg';

import { distFreshnessWarning } from '../apps/server/src/dist-freshness.js';

import { assert, delay, fail, rootDir, run, SmokeFailure, tsxBin } from './smoke-cli.js';

// A fixed high port keeps the Playwright baseURL static (single-tenant page,
// like production). The e2e stack is torn down and rebuilt every run.
const PORT = 47990;
const E2E_DB = 'agentproofarch_e2e';
const WEB_DIST_DIR = join(rootDir, 'dist/web');

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    // Fresh, isolated database each run so e2e never touches dev-seeded data.
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the e2e database "${E2E_DB}". Is the dev Postgres up (npm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const migrateAndSeed = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

/**
 * Production serves one tenant per domain; the browser resolves the tenant from
 * the Host header, never a header the CLI injects. Registering `localhost` as a
 * verified custom domain for the seeded `acme` tenant makes http://localhost the
 * single-tenant page it would be in production, so the login flow lands straight
 * on that tenant's ledger.
 */
const registerLocalhostTenant = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (domain) DO NOTHING`,
      ['domain-e2e-localhost', 'tenant-acme', 'localhost', 'custom', true],
    );
  } finally {
    await client.end();
  }
};

const buildWebIfStale = async (): Promise<void> => {
  if (distFreshnessWarning(WEB_DIST_DIR, rootDir) === null) return;
  console.log('e2e: web bundle missing or stale, building...');
  const build = await run(join(rootDir, 'node_modules/.bin/vite'), [
    'build',
    '--config',
    'apps/web/vite.config.ts',
  ], {});
  assert(build.code === 0, `build:web failed:\n${build.stdout}${build.stderr}`);
};

const bootServer = (): void => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: `http://localhost:${PORT}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR,
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));
};

const waitForHealth = async (): Promise<void> => {
  const healthUrl = `http://localhost:${PORT}/api/health`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // not accepting connections yet
    }
    await delay(300);
  }
  throw new SmokeFailure(`e2e server did not become ready within 20s on port ${PORT}`);
};

try {
  console.log('e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  await registerLocalhostTenant(e2eDatabaseUrl);
  await buildWebIfStale();
  console.log(`e2e: booting server on port ${PORT}...`);
  bootServer();
  await waitForHealth();
  console.log(`e2e: server ready on http://localhost:${PORT}`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\ne2e setup: FAIL\n${message}`);
  process.exit(1);
}
