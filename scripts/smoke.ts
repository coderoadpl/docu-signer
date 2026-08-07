import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';

import {
  assert,
  delay,
  driveCli,
  fail,
  rootDir,
  run,
  SmokeFailure,
  tsxBin,
} from './smoke-cli.js';

const SMOKE_DB = 'agentproofarch_smoke';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const smokeUrlObject = new URL(baseDatabaseUrl);
smokeUrlObject.pathname = `/${SMOKE_DB}`;
const smokeDatabaseUrl = smokeUrlObject.toString();

interface LockPackage {
  version?: string;
  optional?: boolean;
  os?: unknown;
  cpu?: unknown;
}
interface LockFile {
  packages: Record<string, LockPackage>;
}
const readLock = (raw: string): LockFile => JSON.parse(raw);

const checkLockfileDrift = (): void => {
  const src = readLock(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
  let installedRaw: string;
  try {
    installedRaw = readFileSync(join(rootDir, 'node_modules/.package-lock.json'), 'utf8');
  } catch {
    throw new SmokeFailure(
      'Dependencies are not installed (node_modules/.package-lock.json missing). Run: npm install',
    );
  }
  const installed = readLock(installedRaw);
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(src.packages)) {
    if (name === '') continue;
    const present = installed.packages[name];
    // Platform-conditional packages are legitimately absent on this host.
    const platformConditional =
      entry.optional === true || entry.os !== undefined || entry.cpu !== undefined;
    if (!present) {
      if (!platformConditional) problems.push(`missing: ${name}`);
      continue;
    }
    if (entry.version !== undefined && present.version !== undefined && entry.version !== present.version) {
      problems.push(`version: ${name} lock=${entry.version} installed=${present.version}`);
    }
  }
  for (const name of Object.keys(installed.packages)) {
    if (name === '') continue;
    if (!(name in src.packages)) problems.push(`extraneous: ${name}`);
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 10).join('\n  ');
    const rest = problems.length > 10 ? `\n  ...and ${problems.length - 10} more` : '';
    fail(`Installed dependency tree does not match package-lock.json. Run: npm install\n  ${shown}${rest}`);
  }
};

const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    // Fresh, isolated database each run so smoke never touches the dev-seeded data.
    await client.query(`DROP DATABASE IF EXISTS ${SMOKE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SMOKE_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the smoke database "${SMOKE_DB}". Is the dev Postgres up (npm run db:up)?\n${String(cause)}`,
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

const bootServer = async (
  port: number,
  databaseUrl: string,
  webDistDir: string,
): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: `http://localhost:${port}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
    },
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  let exitInfo: string | null = null;
  child.on('exit', (code, signal) => {
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const healthUrl = `http://localhost:${port}/api/health`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      // not accepting connections yet
    }
    await delay(300);
  }
  throw new SmokeFailure(
    `Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`,
  );
};

const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const { pid } = child;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (pid !== undefined) process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
};

const startedAt = Date.now();
const homes: string[] = [];
let server: ChildProcess | null = null;
try {
  console.log('smoke: checking lockfile drift...');
  checkLockfileDrift();
  console.log('smoke: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(smokeDatabaseUrl);
  const port = await ephemeralPort();
  console.log(`smoke: booting server on port ${port}...`);
  const webDistDir = mkdtempSync(join(tmpdir(), 'smoke-web-'));
  homes.push(webDistDir);
  server = await bootServer(port, smokeDatabaseUrl, webDistDir);
  console.log('smoke: driving the CLI...');
  await driveCli(
    { baseUrl: `http://localhost:${port}`, email: 'demo@agentproofarch.dev', password: 'demo1234', tenant: 'acme' },
    homes,
  );
  console.log(`\nsmoke: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
}
