import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ITEST_DB = 'agentproofarch_seed_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const seedDatabaseUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();
const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');

const recreateDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  } finally {
    await admin.end();
  }
  const migrationPool = new pg.Pool({ connectionString: seedDatabaseUrl });
  try {
    await migrateNodePg(drizzleNodePg(migrationPool), { migrationsFolder: 'drizzle' });
  } finally {
    await migrationPool.end();
  }
};

const dropDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
};

const runSeed = (): void => {
  const result = spawnSync(tsxBin, ['adapters/db/seed.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: seedDatabaseUrl,
      BETTER_AUTH_SECRET: 'seed-integration-secret-at-least-32-characters',
      SEED_ADMIN1_EMAIL: 'owner@podpisy.test',
      SEED_ADMIN1_PASSWORD: 'owner-password',
      SEED_ADMIN2_EMAIL: 'admin@podpisy.test',
      SEED_ADMIN2_PASSWORD: 'admin-password',
    },
  });
  expect(result.status, result.stderr).toBe(0);
};

const readDataset = async (client: pg.Client) => {
  const users = await client.query(
    'SELECT id, email, name FROM "user" ORDER BY email',
  );
  const tenants = await client.query(
    'SELECT id, slug, name FROM tenants ORDER BY id',
  );
  const admins = await client.query(
    `SELECT a.id, a.tenant_id, u.email, a.role
      FROM tenant_admins a
      JOIN "user" u ON u.id = a.user_id
      ORDER BY a.id`,
  );
  const members = await client.query(
    `SELECT id, tenant_id, user_id, email, display_name, tags,
      marketing_consents #>> '{0,channel}' AS marketing_channel,
      (marketing_consents #>> '{0,granted}')::boolean AS marketing_granted,
      external_customer_ids, last_seen_at IS NULL AS last_seen_is_null
    FROM members ORDER BY id`,
  );
  const domains = await client.query(
    'SELECT id, tenant_id, domain, kind, verified FROM tenant_domains ORDER BY id',
  );
  const todos = await client.query(
    'SELECT id, tenant_id, title, created_by FROM todos ORDER BY id',
  );
  const documents = await client.query(
    'SELECT id, tenant_id, title, doc_type, document_date, person, tags FROM documents ORDER BY id',
  );
  const documentFiles = await client.query(
    'SELECT id, document_id, role, file_name, content_type, size_bytes, storage_key FROM document_files ORDER BY id',
  );
  return {
    users: users.rows,
    tenants: tenants.rows,
    admins: admins.rows,
    members: members.rows,
    domains: domains.rows,
    todos: todos.rows,
    documents: documents.rows,
    documentFiles: documentFiles.rows,
  };
};

const truncateAfter = async (client: pg.Client, stage: string): Promise<void> => {
  if (stage === 'tenants') {
    await client.query('DELETE FROM tenants');
    return;
  }
  if (stage === 'tenant-admins') {
    await client.query(
      'DELETE FROM tenant_admins; DELETE FROM tenant_domains; DELETE FROM documents',
    );
    return;
  }
  if (stage === 'tenant-domains') {
    await client.query('DELETE FROM tenant_domains; DELETE FROM documents');
    return;
  }
  if (stage === 'documents') {
    await client.query('DELETE FROM documents');
  }
};

let client: pg.Client;

beforeAll(async () => {
  await recreateDatabase();
  client = new pg.Client({ connectionString: seedDatabaseUrl });
  await client.connect();
}, 60_000);

afterAll(async () => {
  await client.end();
  await dropDatabase();
});

describe('seed convergence', () => {
  it(
    'converges from every fork seed stage to one exact idempotent dataset',
    async () => {
      runSeed();
      const expected = await readDataset(client);

      expect(expected.users.map((row) => row.email)).toEqual([
        'admin@podpisy.test',
        'demo@agentproofarch.dev',
        'mag@example.com',
        'owner@podpisy.test',
      ]);
      expect(expected.tenants).toEqual([
        { id: 'tenant-default', slug: 'default', name: 'Archiwum dokumentów' },
      ]);
      expect(expected.admins.map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        email: row.email,
        role: row.role,
      }))).toEqual([
        {
          id: 'admin-default-1',
          tenant_id: 'tenant-default',
          email: 'owner@podpisy.test',
          role: 'owner',
        },
        {
          id: 'admin-default-2',
          tenant_id: 'tenant-default',
          email: 'admin@podpisy.test',
          role: 'admin',
        },
        {
          id: 'admin-default-demo',
          tenant_id: 'tenant-default',
          email: 'demo@agentproofarch.dev',
          role: 'owner',
        },
        {
          id: 'admin-default-magic',
          tenant_id: 'tenant-default',
          email: 'mag@example.com',
          role: 'admin',
        },
      ]);
      expect(expected.members).toEqual([]);
      expect(expected.domains).toEqual([
        {
          id: 'domain-default-localhost',
          tenant_id: 'tenant-default',
          domain: 'default.localhost',
          kind: 'subdomain',
          verified: true,
        },
      ]);
      expect(expected.todos).toEqual([]);
      expect(expected.documents).toEqual([]);
      expect(expected.documentFiles).toEqual([]);

      for (const stage of [
        'tenants',
        'tenant-admins',
        'tenant-domains',
        'documents',
      ]) {
        await truncateAfter(client, stage);
        runSeed();
        expect(await readDataset(client)).toEqual(expected);
      }

      runSeed();
      expect(await readDataset(client)).toEqual(expected);
    },
    45_000,
  );
});
