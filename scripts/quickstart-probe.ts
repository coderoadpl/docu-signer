/**
 * The quickstart's fresh-clone promises, executable: the documented seed-table
 * counts and specifics (member emails/tags/binding, the demo user's grants,
 * the tenant domains), seeding twice as a no-op, a second clone driving the
 * same named dev stack, and the documented CLI hello printing exactly what
 * `website/docs/start/quickstart.md` shows.
 */
import { type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';

import pg from 'pg';
import { z } from 'zod';

import { assert, fail, rootDir, run, SmokeFailure, tsxBin } from './smoke-cli.js';
import { bootServer, ephemeralPort, killServer } from './server-harness.js';

const PROBE_DB = 'agentproofarch_quickstart';
const COMPOSE_PROJECT = 'agentproofarch-dev';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const probeUrlObject = new URL(baseDatabaseUrl);
probeUrlObject.pathname = `/${PROBE_DB}`;
const probeDatabaseUrl = probeUrlObject.toString();

const DOCUMENTED_TODO_LINES = [
  '- Wdrożyć walking skeleton na produkcję  (todo-wal)',
  '- Sprawdzić izolację danych między tenantami  (todo-ten)',
];

const setupDatabase = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    // A throwaway database reproduces the fresh-clone volume the quickstart
    // promises without touching the dev-seeded data the reader is working in.
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${PROBE_DB}`);
  } catch (cause) {
    fail(
      `Could not prepare the probe database "${PROBE_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const migrate = async (): Promise<void> => {
  const result = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: probeDatabaseUrl });
  assert(result.code === 0, `Migration failed:\n${result.stdout}${result.stderr}`);
};

const seed = async (cwd: string): Promise<void> => {
  const result = await run(
    tsxBin,
    [join(cwd, 'adapters/db/seed.ts')],
    { DATABASE_URL: probeDatabaseUrl },
    cwd,
  );
  assert(result.code === 0, `Seed in ${cwd} failed:\n${result.stdout}${result.stderr}`);
};

type Counts = Record<string, number>;
const countRowsSchema = z.array(z.object({ count: z.coerce.number().int().nonnegative() })).length(1);
const tableRowsSchema = z.array(z.object({ table_name: z.string() }));

const readCounts = async (): Promise<Counts> => {
  const client = new pg.Client({ connectionString: probeDatabaseUrl });
  await client.connect();
  try {
    const tables = tableRowsSchema.parse(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
        )
      ).rows,
    );
    const counts: Counts = {};
    for (const { table_name: table } of tables) {
      const rows = countRowsSchema.parse(
        (await client.query(`SELECT count(*) AS count FROM ${pg.escapeIdentifier(table)}`)).rows,
      );
      counts[table] = rows[0]?.count ?? 0;
    }
    return counts;
  } finally {
    await client.end();
  }
};

// The table the quickstart prints under "The seed is worth knowing by heart".
const DOCUMENTED_COUNTS: Counts = {
  members: 3,
  tenant_admins: 2,
  tenant_domains: 2,
  tenants: 2,
  todos: 3,
  user: 1,
};

const assertDocumentedCounts = (counts: Counts): void => {
  for (const [table, expected] of Object.entries(DOCUMENTED_COUNTS)) {
    assert(
      counts[table] === expected,
      `Quickstart documents ${String(expected)} seeded ${table} row(s), the fresh seed produced ${String(counts[table])}`,
    );
  }
};

const memberRowsSchema = z.array(
  z.object({
    email: z.string(),
    slug: z.string(),
    user_id: z.string().nullable(),
    tags: z.array(z.string()),
  }),
);
const staffRowsSchema = z.array(z.object({ slug: z.string(), role: z.string() }));
const domainRowsSchema = z.array(z.object({ slug: z.string(), domain: z.string() }));

// The seed-table specifics the quickstart documents beyond bare counts.
const assertDocumentedSeedDetails = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: probeDatabaseUrl });
  await client.connect();
  try {
    const memberRows = memberRowsSchema.parse(
      (
        await client.query(
          'SELECT m.email, t.slug, m.user_id, m.tags FROM members m JOIN tenants t ON t.id = m.tenant_id ORDER BY m.email',
        )
      ).rows,
    );
    const membersByEmail = new Map(memberRows.map((row) => [row.email, row]));

    const alice = membersByEmail.get('alice@example.com');
    assert(
      alice !== undefined && alice.slug === 'acme',
      `Quickstart documents alice@example.com as an acme member, got ${JSON.stringify(memberRows)}`,
    );
    assert(
      alice.tags.join(',') === 'vip,early-adopter',
      `Quickstart documents alice@example.com tagged vip, early-adopter, got ${JSON.stringify(alice.tags)}`,
    );
    const mag = membersByEmail.get('mag@example.com');
    assert(
      mag !== undefined && mag.slug === 'acme',
      `Quickstart documents mag@example.com as an acme member, got ${JSON.stringify(memberRows)}`,
    );
    assert(
      mag.user_id === null,
      `Quickstart documents mag@example.com as provisioned with no account yet, got user_id=${JSON.stringify(mag.user_id)}`,
    );
    const bob = membersByEmail.get('bob@example.com');
    assert(
      bob !== undefined && bob.slug === 'globex',
      `Quickstart documents bob@example.com as a globex member, got ${JSON.stringify(memberRows)}`,
    );

    const staffRows = staffRowsSchema.parse(
      (
        await client.query(
          `SELECT t.slug, ta.role FROM tenant_admins ta JOIN tenants t ON t.id = ta.tenant_id JOIN "user" u ON u.id = ta.user_id WHERE u.email = 'demo@agentproofarch.dev' ORDER BY t.slug`,
        )
      ).rows,
    );
    const staff = staffRows.map((row) => `${row.slug}=${row.role}`).join(' ');
    assert(
      staff === 'acme=owner globex=admin',
      `Quickstart documents the demo user as owner in acme and admin in globex, got "${staff}"`,
    );

    const domainRows = domainRowsSchema.parse(
      (
        await client.query(
          'SELECT t.slug, td.domain FROM tenant_domains td JOIN tenants t ON t.id = td.tenant_id ORDER BY td.domain',
        )
      ).rows,
    );
    const domains = domainRows.map((row) => `${row.slug}=${row.domain}`).join(' ');
    assert(
      domains === 'acme=acme.localhost globex=globex.localhost',
      `Quickstart documents domains acme.localhost and globex.localhost, got "${domains}"`,
    );
  } finally {
    await client.end();
  }
};

const assertSameCounts = (before: Counts, after: Counts, label: string): void => {
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    `${label} changed row counts\nbefore=${JSON.stringify(before)}\nafter=${JSON.stringify(after)}`,
  );
};

const composeProjectName = async (cwd: string): Promise<string> => {
  const result = await run(
    'docker',
    ['compose', '-f', 'docker-compose.dev.yml', 'config', '--format', 'json'],
    {},
    cwd,
  );
  assert(
    result.code === 0,
    `docker compose config failed in ${cwd}:\n${result.stdout}${result.stderr}`,
  );
  return z.object({ name: z.string() }).parse(JSON.parse(result.stdout)).name;
};

/**
 * A second clone lives in a differently named directory, which is exactly what
 * used to hand it its own Compose project — and with it a second, empty
 * database that looked like a broken seed.
 */
const copyClone = (tempRoot: string): string => {
  const copyDir = join(tempRoot, 'second-clone');
  assert(
    basename(copyDir) !== basename(rootDir),
    'The copied clone must not share its directory name with the checkout',
  );
  const excluded = new Set(['coverage', 'dist', 'node_modules', 'test-results', '.env']);
  cpSync(rootDir, copyDir, {
    recursive: true,
    filter: (source) => {
      const path = relative(rootDir, source);
      return path === '' || !excluded.has(path.split(sep)[0] ?? '');
    },
  });
  symlinkSync(join(rootDir, 'node_modules'), join(copyDir, 'node_modules'), 'dir');
  return copyDir;
};

const cli = async (args: string[], baseUrl: string, home: string): Promise<string> => {
  const result = await run(tsxBin, ['apps/cli/src/main.ts', '--api-url', baseUrl, ...args], {
    HOME: home,
  });
  assert(
    result.code === 0,
    `cli ${args.join(' ')} exited ${String(result.code)}\n${result.stdout}${result.stderr}`,
  );
  return result.stdout;
};

const assertLine = (stdout: string, expected: string, label: string): void => {
  assert(
    stdout.trim() === expected,
    `Quickstart shows "${expected}" for ${label}, the CLI printed "${stdout.trim()}"`,
  );
};

const healthSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    status: z.literal('ok'),
    database: z.literal('up'),
    version: z.string(),
    sha: z.string(),
  }),
});

const assertDocumentedCliHello = async (baseUrl: string, home: string): Promise<void> => {
  const health = await cli(['--json', 'health'], baseUrl, home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(health);
  } catch {
    throw new SmokeFailure(`Quickstart shows a JSON envelope for --json health, got:\n${health}`);
  }
  healthSchema.parse(parsed);

  assertLine(
    await cli(['login', '--email', 'demo@agentproofarch.dev', '--password', 'demo1234'], baseUrl, home),
    'signed in as demo@agentproofarch.dev',
    'login',
  );
  assertLine(
    await cli(['whoami'], baseUrl, home),
    'demo@agentproofarch.dev (no tenant selected)',
    'whoami before tenant switch',
  );
  assertLine(
    await cli(['tenant', 'switch', 'acme'], baseUrl, home),
    'active tenant: Acme Sp. z o.o. (acme)',
    'tenant switch acme',
  );
  assertLine(
    await cli(['whoami'], baseUrl, home),
    'demo@agentproofarch.dev @ Acme Sp. z o.o. (acme, staff: owner)',
    'whoami after tenant switch',
  );
  assertLine(
    await cli(['todo', 'list'], baseUrl, home),
    DOCUMENTED_TODO_LINES.join('\n'),
    'todo list',
  );
};

const startedAt = Date.now();
const tempRoot = mkdtempSync(join(tmpdir(), 'quickstart-probe-'));
let server: ChildProcess | null = null;
try {
  console.log('quickstart:probe: seeding a fresh database...');
  await setupDatabase();
  await migrate();
  await seed(rootDir);
  const seeded = await readCounts();
  assertDocumentedCounts(seeded);
  await assertDocumentedSeedDetails();

  console.log('quickstart:probe: seeding again (the documented no-op)...');
  await seed(rootDir);
  assertSameCounts(seeded, await readCounts(), 'A repeated seed');

  console.log('quickstart:probe: checking the second clone...');
  const copyDir = copyClone(tempRoot);
  for (const dir of [rootDir, copyDir]) {
    const name = await composeProjectName(dir);
    assert(
      name === COMPOSE_PROJECT,
      `${dir} resolves Compose project "${name}", not the shared "${COMPOSE_PROJECT}"`,
    );
  }
  await seed(copyDir);
  assertSameCounts(seeded, await readCounts(), "The second clone's seed");

  console.log('quickstart:probe: driving the documented CLI hello...');
  const port = await ephemeralPort();
  const webDistDir = join(tempRoot, 'web');
  const home = join(tempRoot, 'home');
  mkdirSync(webDistDir);
  mkdirSync(home);
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>quickstart probe</title>\n');
  server = await bootServer({ port, databaseUrl: probeDatabaseUrl, webDistDir });
  await assertDocumentedCliHello(`http://localhost:${port}`, home);

  console.log(`\nquickstart:probe: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nquickstart:probe: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  rmSync(tempRoot, { recursive: true, force: true });
}
