import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTenantDomainRepository } from '#adapters/db/repositories.js';
import { tenantDomains, tenants } from '#adapters/db/schema.js';
import * as schema from '#adapters/db/schema.js';

import { buildInternalApp } from './internal-app.js';

const ITEST_DB = 'agentproofarch_domaincheck_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

const itestUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();

const closePool = async (pool: pg.Pool): Promise<void> => {
  const clientCount = pool.totalCount;
  if (clientCount === 0) {
    await pool.end();
    return;
  }

  let removedClientCount = 0;
  const clientsClosed = new Promise<void>((resolve) => {
    pool.on('remove', () => {
      removedClientCount += 1;
      if (removedClientCount === clientCount) resolve();
    });
  });

  await pool.end();
  await clientsClosed;
};

let appPool: pg.Pool;
let db: ReturnType<typeof drizzleNodePg<typeof schema>>;
let app: ReturnType<typeof buildInternalApp>;

const withAdmin = async (run: (admin: pg.Client) => Promise<void>): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await run(admin);
  } finally {
    await admin.end();
  }
};

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  });

  const migrationPool = new pg.Pool({ connectionString: itestUrl });
  try {
    await migrateNodePg(drizzleNodePg(migrationPool), { migrationsFolder: 'drizzle' });
  } finally {
    await closePool(migrationPool);
  }

  appPool = new pg.Pool({ connectionString: itestUrl });
  db = drizzleNodePg(appPool, { schema });
  await db
    .insert(tenants)
    .values({ id: 't-acme', slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' });
  await db.insert(tenantDomains).values([
    { id: 'd-verified', tenantId: 't-acme', domain: 'shop.acme.com', kind: 'custom', verified: true },
    { id: 'd-pending', tenantId: 't-acme', domain: 'pending.acme.com', kind: 'custom', verified: false },
  ]);

  app = buildInternalApp({
    tenantDomains: createTenantDomainRepository(db),
  });
}, 60_000);

afterAll(async () => {
  await closePool(appPool);
  await withAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
  });
});

describe('domain-check endpoint against Postgres', () => {
  it('returns 200 for a verified tenant domain', async () => {
    const res = await app.request('/internal/domain-check?domain=shop.acme.com');
    expect(res.status).toBe(200);
  });

  it('returns 404 for an existing-but-unverified domain', async () => {
    const res = await app.request('/internal/domain-check?domain=pending.acme.com');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a domain no tenant has attached', async () => {
    const res = await app.request('/internal/domain-check?domain=ghost.example.com');
    expect(res.status).toBe(404);
  });
});
