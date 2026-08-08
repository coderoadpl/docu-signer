import { exec, spawn } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';

import pg from 'pg';

import { distFreshnessWarning } from '../apps/server/src/dist-freshness.js';

import { assert, delay, fail, rootDir, run, SmokeFailure, tsxBin } from './smoke-cli.js';
import { clearMailpit, waitForMailpit } from './mailpit.js';

// A fixed high port keeps the Playwright baseURL static (single-tenant page,
// like production). The e2e stack is torn down and rebuilt every run.
const PORT = 47990;
const E2E_DB = 'agentproofarch_e2e';
const WEB_DIST_DIR = join(rootDir, 'dist/web');
// The dev/CI Mailpit (docker-compose.dev.yml): the real smtp adapter delivers
// the US-026 magic link here; the magic-link spec reads it back over its HTTP API.
const MAILPIT_SMTP_PORT = 47925;
const MAILPIT_API_URL = 'http://localhost:47980';

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
      `Could not prepare the e2e database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });

// A hardcoded port keeps the Playwright baseURL static, but on CI a leftover
// listener or a TIME_WAIT socket from an earlier run in the same job makes the
// server's bind fail with EADDRINUSE — killing the whole e2e job before any
// test runs, which `retries` cannot recover. Wait the transient out, and after
// a grace period force-free the port (fuser is Linux-only; the exec no-ops
// elsewhere — dev reuses the existing server anyway).
const ensurePortFree = async (port: number): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isPortFree(port)) return;
    if (attempt === 4) await new Promise<void>((resolve) => exec(`fuser -k ${port}/tcp`, () => resolve()));
    await delay(500);
  }
  throw new SmokeFailure(`port ${port} is still occupied after 10s; cannot boot the e2e server`);
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
      // Real smtp transport → the dev/CI Mailpit captures the magic-link send.
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(MAILPIT_SMTP_PORT),
      SMTP_SECURE: 'false',
      // Surfaced by the domains settings page (US-019) as the DNS record tenants
      // create; the noop provisioner still verifies every domain regardless.
      SELF_HOST_TARGET_CNAME: 'apps.agentproofarch.test',
      // The suite fires many sign-ins from one shared bucket (no client IP
      // behind the harness) — production keeps the limiter on.
      AUTH_RATE_LIMIT: 'off',
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
  console.log('e2e: waiting for Mailpit...');
  await waitForMailpit(MAILPIT_API_URL).catch((cause: unknown) => {
    fail(`Mailpit is not reachable at ${MAILPIT_API_URL}. Is it up (pnpm run db:up)?\n${String(cause)}`);
  });
  await clearMailpit(MAILPIT_API_URL);
  await buildWebIfStale();
  await ensurePortFree(PORT);
  console.log(`e2e: booting server on port ${PORT}...`);
  bootServer();
  await waitForHealth();
  console.log(`e2e: server ready on http://localhost:${PORT}`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\ne2e setup: FAIL\n${message}`);
  process.exit(1);
}
