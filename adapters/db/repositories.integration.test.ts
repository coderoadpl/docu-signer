import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDocumentRepository } from './documents-repository.js';
import { createTenantAccessReader } from './repositories.js';
import { createSavedSearchRepository } from './saved-searches-repository.js';
import { tenantAdmins, tenants } from './schema.js';
import * as schema from './schema.js';
import { closePoolAndDropIntegrationDatabase } from './test-support/integration-database.js';

const ITEST_DB = 'agentproofarch_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';
const itestUrl = new URL(baseDatabaseUrl);
itestUrl.pathname = `/${ITEST_DB}`;

let pool: pg.Pool;
let db: NodePgDatabase<typeof schema>;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: itestUrl.toString() });
  db = drizzleNodePg(pool, { schema });
  await migrateNodePg(db, { migrationsFolder: 'drizzle' });
  await db.insert(tenants).values([
    { id: 'tenant-a', slug: 'a', name: 'A', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'tenant-b', slug: 'b', name: 'B', createdAt: '2026-08-01T00:00:00.000Z' },
  ]);
  await db.insert(tenantAdmins).values([
    { id: 'grant-owner', tenantId: 'tenant-a', userId: 'user-owner', role: 'owner' },
    { id: 'grant-admin', tenantId: 'tenant-b', userId: 'user-admin', role: 'admin' },
  ]);
});

afterAll(async () => {
  await closePoolAndDropIntegrationDatabase({
    pool,
    adminDatabaseUrl: baseDatabaseUrl,
    databaseName: ITEST_DB,
  });
});

describe('DocumentRepository', () => {
  it('round-trips documents and isolates every read by tenant', async () => {
    const repository = createDocumentRepository(db);
    const created = await repository.create({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-a',
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      person: 'Jan Kowalski',
      tags: ['podpis'],
    });

    expect(created.title).toBe('Umowa');
    expect(created.periodStart).toBe('2026-07-01');
    expect(created.periodEnd).toBe('2026-07-31');
    expect(await repository.listByTenant('tenant-a', {})).toHaveLength(1);
    expect(await repository.listByTenant('tenant-a', { tag: 'podpis' })).toHaveLength(1);
    expect(await repository.listByTenant('tenant-a', { dateFrom: '2026-07-15' })).toHaveLength(1);
    expect(await repository.listByTenant('tenant-a', { dateFrom: '2026-08-02' })).toEqual([]);
    expect(await repository.listByTenant('tenant-b', {})).toEqual([]);
    expect(
      await repository.findById('tenant-b', '11111111-1111-4111-8111-111111111111'),
    ).toBeNull();
  });

  it('keeps attachment lookup tenant-scoped', async () => {
    const repository = createDocumentRepository(db);
    const file = await repository.createFile('tenant-a', {
      id: '22222222-2222-4222-8222-222222222222',
      documentId: '11111111-1111-4111-8111-111111111111',
      role: 'source',
      fileName: 'umowa.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/document/file',
    });

    expect(file?.fileName).toBe('umowa.pdf');
    expect(
      await repository.findFile(
        'tenant-b',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    ).toBeNull();
  });

  it('filters signature status through document file roles', async () => {
    const repository = createDocumentRepository(db);
    await repository.create({
      id: '12121212-1212-4121-8121-121212121212',
      tenantId: 'tenant-a',
      title: 'Do podpisania',
      docType: 'umowa-uod',
      documentDate: '2026-08-03',
      periodStart: null,
      periodEnd: null,
      person: 'Anna Nowak',
      tags: ['status-filter'],
    });
    await repository.create({
      id: '13131313-1313-4131-8131-131313131313',
      tenantId: 'tenant-a',
      title: 'Podpisany',
      docType: 'umowa-uod',
      documentDate: '2026-08-02',
      periodStart: null,
      periodEnd: null,
      person: 'Anna Nowak',
      tags: ['status-filter'],
    });
    await repository.create({
      id: '14141414-1414-4141-8141-141414141414',
      tenantId: 'tenant-a',
      title: 'Bez źródła',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: 'Anna Nowak',
      tags: ['status-filter'],
    });
    await repository.createFile('tenant-a', {
      id: '15151515-1515-4151-8151-151515151515',
      documentId: '12121212-1212-4121-8121-121212121212',
      role: 'source',
      fileName: 'do-podpisania.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/status/needs/source',
    });
    await repository.createFile('tenant-a', {
      id: '16161616-1616-4161-8161-161616161616',
      documentId: '13131313-1313-4131-8131-131313131313',
      role: 'source',
      fileName: 'podpisany.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/status/signed/source',
    });
    await repository.createFile('tenant-a', {
      id: '17171717-1717-4171-8171-171717171717',
      documentId: '13131313-1313-4131-8131-131313131313',
      role: 'signed-digital',
      fileName: 'podpisany-signed.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/status/signed/digital',
    });
    await repository.createFile('tenant-a', {
      id: '18181818-1818-4181-8181-181818181818',
      documentId: '14141414-1414-4141-8141-141414141414',
      role: 'other',
      fileName: 'notatka.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/status/other/file',
    });

    await expect(
      repository.listByTenant('tenant-a', {
        tag: 'status-filter',
        signatureStatus: 'needs-signature',
      }),
    ).resolves.toMatchObject([{ title: 'Do podpisania' }]);
    await expect(
      repository.listByTenant('tenant-a', {
        tag: 'status-filter',
        signatureStatus: 'signed',
      }),
    ).resolves.toMatchObject([{ title: 'Podpisany' }]);
  });
});

describe('SavedSearchRepository', () => {
  it('round-trips saved searches and isolates every operation by tenant', async () => {
    const repository = createSavedSearchRepository(db);
    const created = await repository.create({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: 'tenant-a',
      name: 'Protokoły Anny',
      filter: {
        docType: 'protokol',
        person: 'Anna',
        tag: 'odbiór',
        signatureStatus: 'signed',
      },
    });

    expect(created).toMatchObject({
      name: 'Protokoły Anny',
      filter: {
        docType: 'protokol',
        person: 'Anna',
        tag: 'odbiór',
        signatureStatus: 'signed',
      },
    });
    await repository.create({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tenantId: 'tenant-b',
      name: 'Umowy',
      filter: { docType: 'umowa-uod' },
    });

    await expect(repository.listByTenant('tenant-a')).resolves.toMatchObject([
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: 'tenant-a' },
    ]);
    await expect(repository.listByTenant('tenant-b')).resolves.toMatchObject([
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tenantId: 'tenant-b' },
    ]);
    await expect(
      repository.delete('tenant-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ).resolves.toBe(false);
    await expect(
      repository.delete('tenant-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ).resolves.toBe(true);
  });
});

describe('TenantAccessReader', () => {
  it('finds only the exact user and tenant grant with a parsed staff role', async () => {
    const reader = createTenantAccessReader(db);

    await expect(reader.findStaffGrant('user-owner', 'tenant-a')).resolves.toEqual({
      staffRole: 'owner',
    });
    await expect(reader.findStaffGrant('user-admin', 'tenant-b')).resolves.toEqual({
      staffRole: 'admin',
    });
    await expect(reader.findStaffGrant('user-owner', 'tenant-b')).resolves.toBeNull();
    await expect(reader.findStaffGrant('missing-user', 'tenant-a')).resolves.toBeNull();
  });
});

describe('database invariants', () => {
  it('rejects invalid closed-set and attachment-size values through raw SQL', async () => {
    await pool.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ('tenant-constraints', 'constraints', 'Constraints', '2026-08-01T00:00:00.000Z')`,
    );
    await expect(
      pool.query(
        `INSERT INTO tenant_admins (id, tenant_id, user_id, role)
         VALUES ('grant-invalid', 'tenant-constraints', 'user-invalid', 'member')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
         VALUES ('domain-invalid', 'tenant-constraints', 'invalid.example.com', 'alias', true)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO documents (id, tenant_id, title, doc_type, document_date)
         VALUES ('33333333-3333-4333-8333-333333333333', 'tenant-constraints', 'Invalid', 'contract', '2026-08-01')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `INSERT INTO documents (id, tenant_id, title, doc_type, document_date)
       VALUES ('44444444-4444-4444-8444-444444444444', 'tenant-constraints', 'Valid', 'inny', '2026-08-01')`,
    );
    await expect(
      pool.query(
        `INSERT INTO document_files
           (id, document_id, role, file_name, content_type, size_bytes, storage_key)
         VALUES
           ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444',
            'original', 'invalid.pdf', 'application/pdf', 1, 'constraints/invalid-role')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO document_files
           (id, document_id, role, file_name, content_type, size_bytes, storage_key)
         VALUES
           ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
            'source', 'oversized.pdf', 'application/pdf', 26214401, 'constraints/oversized')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('cascades every supported tenant-scoped row and leaves a sibling untouched', async () => {
    await pool.query(
      `INSERT INTO tenants (id, slug, name, created_at) VALUES
         ('tenant-offboard', 'offboard', 'Offboard', '2026-08-01T00:00:00.000Z'),
         ('tenant-sibling', 'sibling', 'Sibling', '2026-08-01T00:00:00.000Z')`,
    );
    for (const suffix of ['offboard', 'sibling']) {
      await pool.query(
        `INSERT INTO tenant_admins (id, tenant_id, user_id, role)
         VALUES ($1, $2, $3, 'owner')`,
        [`grant-${suffix}`, `tenant-${suffix}`, `user-${suffix}`],
      );
      await pool.query(
        `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
         VALUES ($1, $2, $3, 'custom', true)`,
        [`domain-${suffix}`, `tenant-${suffix}`, `${suffix}.example.com`],
      );
      await pool.query(
        `INSERT INTO documents (id, tenant_id, title, doc_type, document_date)
         VALUES ($1, $2, $3, 'inny', '2026-08-01')`,
        [
          suffix === 'offboard'
            ? '77777777-7777-4777-8777-777777777777'
            : '88888888-8888-4888-8888-888888888888',
          `tenant-${suffix}`,
          suffix,
        ],
      );
      await pool.query(
        `INSERT INTO saved_searches (id, tenant_id, name, filter)
         VALUES ($1, $2, $3, '{"docType":"inny"}'::jsonb)`,
        [
          suffix === 'offboard'
            ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
            : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          `tenant-${suffix}`,
          `Teczka ${suffix}`,
        ],
      );
      await pool.query(
        `INSERT INTO document_files
           (id, document_id, role, file_name, content_type, size_bytes, storage_key)
         VALUES ($1, $2, 'source', $3, 'application/pdf', 1, $4)`,
        [
          suffix === 'offboard'
            ? '99999999-9999-4999-8999-999999999999'
            : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          suffix === 'offboard'
            ? '77777777-7777-4777-8777-777777777777'
            : '88888888-8888-4888-8888-888888888888',
          `${suffix}.pdf`,
          `cascade/${suffix}`,
        ],
      );
    }

    await pool.query(`DELETE FROM tenants WHERE id = 'tenant-offboard'`);

    const removed = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_admins WHERE tenant_id = 'tenant-offboard'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_domains WHERE tenant_id = 'tenant-offboard'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM documents WHERE tenant_id = 'tenant-offboard'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM document_files WHERE storage_key = 'cascade/offboard'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM saved_searches WHERE tenant_id = 'tenant-offboard'`,
      ),
    ]);
    const sibling = await Promise.all([
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_admins WHERE tenant_id = 'tenant-sibling'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_domains WHERE tenant_id = 'tenant-sibling'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM documents WHERE tenant_id = 'tenant-sibling'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM document_files WHERE storage_key = 'cascade/sibling'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM saved_searches WHERE tenant_id = 'tenant-sibling'`,
      ),
    ]);

    expect(removed.map((result) => result.rows[0]?.count)).toEqual([0, 0, 0, 0, 0]);
    expect(sibling.map((result) => result.rows[0]?.count)).toEqual([1, 1, 1, 1, 1]);
  });
});
