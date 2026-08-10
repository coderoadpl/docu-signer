import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { verifyPassword } from 'better-auth/crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import { configuredSeedAdmins, ensureDeploySeed, ensureSeedAdmins } from './seed-admins.js';
import {
  account,
  members,
  tenantAdmins,
  tenantDomains,
  tenants,
  todos,
  user,
} from './schema.js';
import * as schema from './schema.js';
import { closePoolAndDropIntegrationDatabase } from './test-support/integration-database.js';

const ITEST_DB = 'agentproofarch_seed_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const itestUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();

let appPool: pg.Pool;
let db: Db;

const recreateDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  } finally {
    await admin.end();
  }
};

beforeAll(async () => {
  await recreateDatabase();
  const migrationPool = new pg.Pool({ connectionString: itestUrl });
  try {
    await migrateNodePg(drizzleNodePg(migrationPool), { migrationsFolder: 'drizzle' });
  } finally {
    await migrationPool.end();
  }
  appPool = new pg.Pool({ connectionString: itestUrl });
  db = drizzleNodePg(appPool, { schema });
}, 60_000);

afterAll(async () => {
  await closePoolAndDropIntegrationDatabase({
    pool: appPool,
    adminDatabaseUrl: baseDatabaseUrl,
    databaseName: ITEST_DB,
  });
});

describe('deploy admin seed', () => {
  it('creates one bootstrap owner only in a zero-user database and never refreshes it later', async () => {
    const absent = configuredSeedAdmins({});
    expect(absent).toEqual([]);
    expect(await ensureSeedAdmins(db, absent)).toEqual([]);
    expect(await ensureDeploySeed(db, absent, 'docu-signer-nine.vercel.app')).toEqual({
      admins: [],
      domain: null,
    });
    expect(await db.select().from(tenants)).toEqual([]);
    expect(await db.select().from(tenantDomains)).toEqual([]);

    const initial = configuredSeedAdmins({
      SEED_ADMIN1_EMAIL: 'owner@deploy.example',
      SEED_ADMIN1_PASSWORD: 'first-password',
    });
    expect(await ensureDeploySeed(db, initial, 'docu-signer-nine.vercel.app')).toEqual({
      admins: [{ email: 'owner@deploy.example', role: 'owner', status: 'created' }],
      domain: {
        domain: 'docu-signer-nine.vercel.app',
        status: 'created',
      },
    });

    const rerun = configuredSeedAdmins({
      SEED_ADMIN1_EMAIL: 'owner@deploy.example',
      SEED_ADMIN1_PASSWORD: 'second-password',
    });
    expect(await ensureDeploySeed(db, rerun, 'changed.example')).toEqual({
      admins: [],
      domain: null,
    });

    const tenantRows = await db.select().from(tenants);
    expect(tenantRows).toHaveLength(1);
    expect(tenantRows[0]).toMatchObject({ id: 'tenant-default', slug: 'default' });

    const userRows = await db.select().from(user);
    expect(userRows.map((row) => row.email)).toEqual(['owner@deploy.example']);
    const grantRows = await db.select().from(tenantAdmins);
    expect(grantRows.map((row) => row.role)).toEqual(['owner']);

    const accountRows = await db.select().from(account);
    expect(accountRows).toHaveLength(1);
    const owner = userRows.find((row) => row.email === 'owner@deploy.example');
    const ownerCredential = accountRows.find((row) => row.userId === owner?.id);
    if (!ownerCredential?.password) throw new Error('Owner credential was not seeded');
    expect(
      await verifyPassword({ hash: ownerCredential.password, password: 'first-password' }),
    ).toBe(true);
    expect(
      await verifyPassword({ hash: ownerCredential.password, password: 'second-password' }),
    ).toBe(false);

    expect(await db.select().from(members)).toEqual([]);
    expect(await db.select().from(todos)).toEqual([]);

    const domainRows = await db.select().from(tenantDomains);
    expect(domainRows).toHaveLength(1);
    expect(domainRows[0]).toMatchObject({
      tenantId: 'tenant-default',
      domain: 'docu-signer-nine.vercel.app',
      kind: 'custom',
      verified: true,
    });
  });
});
