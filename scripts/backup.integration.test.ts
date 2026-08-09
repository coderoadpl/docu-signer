import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePoolAndDropIntegrationDatabase } from '#adapters/db/test-support/integration-database.js';

import { readBackupIndexRows } from './backup.js';

const ITEST_DB = 'agentproofarch_backup_itest';
const hasExecutableOnPath = (name: string): boolean => {
  const path = process.env['PATH'] ?? '';
  for (const directory of path.split(delimiter)) {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

const hasPsql = hasExecutableOnPath(process.platform === 'win32' ? 'psql.exe' : 'psql');
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const indexDatabaseUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();

const recreateDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(ITEST_DB)} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(ITEST_DB)}`);
  } finally {
    await admin.end();
  }
  const migrationPool = new pg.Pool({ connectionString: indexDatabaseUrl });
  try {
    await migrateNodePg(drizzleNodePg(migrationPool), { migrationsFolder: join(process.cwd(), 'drizzle') });
  } finally {
    await migrationPool.end();
  }
};

let client: pg.Pool;

beforeAll(async () => {
  await recreateDatabase();
  client = new pg.Pool({ connectionString: indexDatabaseUrl });
}, 60_000);

afterAll(async () => {
  await closePoolAndDropIntegrationDatabase({
    pool: client,
    adminDatabaseUrl: baseDatabaseUrl,
    databaseName: ITEST_DB,
  });
});

describe('backup index database query', () => {
  it.skipIf(!hasPsql)('reads document file metadata through psql JSON output', async () => {
    await client.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ('tenant-backup', 'backup', 'Backup tenant', now())`,
    );
    await client.query(
      `INSERT INTO documents (id, tenant_id, title, doc_type, document_date, person, tags)
       VALUES
        ('11111111-1111-4111-8111-111111111111', 'tenant-backup', 'Zgoda', 'inny', '2026-08-01', NULL, '[]'::jsonb),
        ('22222222-2222-4222-8222-222222222222', 'tenant-backup', 'Akt', 'uchwala', '2026-08-02', 'Anna Nowak', '[]'::jsonb)`,
    );
    await client.query(
      `INSERT INTO document_files
        (id, document_id, role, file_name, content_type, size_bytes, storage_key, created_at)
       VALUES
        ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'source', 'zgoda.pdf', 'application/pdf', 10, 'documents/tenant-backup/zgoda/source', now()),
        ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'signed-digital', 'akt-podpisany.pdf', 'application/pdf', 20, 'documents/tenant-backup/akt/signed', now())`,
    );

    await expect(readBackupIndexRows(indexDatabaseUrl)).resolves.toEqual([
      {
        documentId: '22222222-2222-4222-8222-222222222222',
        documentTitle: 'Akt',
        docType: 'uchwala',
        person: 'Anna Nowak',
        role: 'signed-digital',
        fileName: 'akt-podpisany.pdf',
        contentType: 'application/pdf',
        sizeBytes: 20,
        pathname: 'documents/tenant-backup/akt/signed',
      },
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        documentTitle: 'Zgoda',
        docType: 'inny',
        person: null,
        role: 'source',
        fileName: 'zgoda.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        pathname: 'documents/tenant-backup/zgoda/source',
      },
    ]);
  });
});
