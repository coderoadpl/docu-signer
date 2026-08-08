import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBackfillRepository } from '#adapters/db/backfill-repository.js';
import { createTenantDomainRepository } from '#adapters/db/repositories.js';
import { members, tenantDomains, tenants } from '#adapters/db/schema.js';
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
    await migrationPool.end();
  }

  appPool = new pg.Pool({ connectionString: itestUrl });
  // Same hazard as repositories.integration.test.ts: afterAll's FORCE drop can
  // race the pool's socket teardown and a 57P01-terminated client would crash
  // the run via an unhandled 'error' event.
  appPool.on('error', () => {});
  db = drizzleNodePg(appPool, { schema });
  await db
    .insert(tenants)
    .values({ id: 't-acme', slug: 'acme', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z' });
  await db.insert(tenantDomains).values([
    { id: 'd-verified', tenantId: 't-acme', domain: 'shop.acme.com', kind: 'custom', verified: true },
    { id: 'd-pending', tenantId: 't-acme', domain: 'pending.acme.com', kind: 'custom', verified: false },
  ]);

  // Five members with MIXED-CASE emails for the demo backfill to normalise.
  await db.insert(members).values(
    Array.from({ length: 5 }, (_unused, i) => ({
      id: `bf-member-${i}`,
      tenantId: 't-acme',
      email: `Person${i}@EXAMPLE.com`,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  );

  app = buildInternalApp({
    tenantDomains: createTenantDomainRepository(db),
    backfills: createBackfillRepository(db),
  });
}, 60_000);

afterAll(async () => {
  await appPool.end();
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

describe('backfill endpoint against Postgres (batch-checkpointed to completion)', () => {
  const runBatch = async (limit: number) => {
    const res = await app.request(`/internal/backfills/members-email-normalize?limit=${limit}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  it('drives the demo backfill to completion across multiple calls, resuming from the checkpoint', async () => {
    // Five rows, two per call: page 1 (2), page 2 (2), page 3 (1, under limit → done).
    const first = await runBatch(2);
    expect(first).toMatchObject({ processed: 2, done: false });
    const second = await runBatch(2);
    expect(second).toMatchObject({ processed: 4, done: false });
    const third = await runBatch(2);
    expect(third).toMatchObject({ processed: 5, done: true });

    // Idempotent + latched: a further call short-circuits on the done checkpoint.
    const extra = await runBatch(2);
    expect(extra).toMatchObject({ processed: 5, done: true });

    // Every member email is now lowercased (the backfill's actual effect).
    const rows = await db.select({ email: members.email }).from(members);
    expect(rows.every((row) => row.email === row.email.toLowerCase())).toBe(true);
    expect(rows).toHaveLength(5);
  });
});
