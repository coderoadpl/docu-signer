import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDocumentRepository } from './documents-repository.js';
import { createPadSessionRepository } from './pad-sessions-repository.js';
import { createApiTokenRepository } from './api-tokens-repository.js';
import { createTenantAccessReader } from './repositories.js';
import { createSavedSearchRepository } from './saved-searches-repository.js';
import { createUserPreferenceRepository } from './user-preferences-repository.js';
import { createTenantSettingsRepository } from './tenant-settings-repository.js';
import { createSignatureRecordRepository } from './signature-records-repository.js';
import { createSourceUpdateRequestRepository } from './source-update-requests-repository.js';
import { tenantAdmins, tenants, user } from './schema.js';
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
  await db.insert(user).values([
    { id: 'user-owner', email: 'owner@example.com', name: 'Owner' },
    { id: 'user-admin', email: 'admin@example.com', name: 'Admin' },
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

    const draft = await repository.create({
      id: '19191919-1919-4191-8191-191919191919',
      tenantId: 'tenant-a',
      title: 'Szkic',
      docType: 'inny',
      documentDate: '2026-08-02',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: ['draft'],
      draft: true,
    });
    expect(draft.draft).toBe(true);
    expect(await repository.listByTenant('tenant-a', {})).toHaveLength(1);
    await expect(repository.listByTenant('tenant-a', { draft: 'true' })).resolves.toMatchObject([
      { title: 'Szkic', draft: true },
    ]);
    await expect(repository.listByTenant('tenant-a', { draft: 'all' })).resolves.toHaveLength(2);
    await expect(repository.approve('tenant-a', draft.id)).resolves.toMatchObject({
      draft: false,
    });
    await expect(repository.listByTenant('tenant-a', { draft: 'true' })).resolves.toEqual([]);
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

  it('soft-deletes, restores and purges documents while active reads exclude trash', async () => {
    const repository = createDocumentRepository(db);
    const id = '29292929-2929-4292-8292-292929292929';
    const fileId = '20202020-2020-4202-8202-202020202020';
    await repository.create({
      id,
      tenantId: 'tenant-a',
      title: 'Kosz',
      docType: 'inny',
      documentDate: '2026-08-04',
      periodStart: null,
      periodEnd: null,
      person: 'Trash Person',
      tags: ['trash-itest'],
    });
    await repository.createFile('tenant-a', {
      id: fileId,
      documentId: id,
      role: 'source',
      fileName: 'kosz.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/trash-itest/source',
    });

    await expect(repository.delete('tenant-b', id)).resolves.toBe(false);
    await expect(repository.delete('tenant-a', id)).resolves.toBe(true);
    await expect(repository.findById('tenant-a', id)).resolves.toBeNull();
    await expect(repository.listByTenant('tenant-a', { tag: 'trash-itest' })).resolves.toEqual([]);
    await expect(repository.listByTenant('tenant-a', { text: 'Kosz' })).resolves.toEqual([]);
    await expect(repository.listFiles('tenant-a', id)).resolves.toEqual([]);
    await expect(repository.findFile('tenant-a', id, fileId)).resolves.toBeNull();

    const deleted = await repository.findDeletedById('tenant-a', id);
    expect(deleted).toMatchObject({ id, deletedAt: expect.any(String) });
    await expect(repository.findAnyById('tenant-a', id)).resolves.toMatchObject({
      id,
      deletedAt: expect.any(String),
    });
    await expect(repository.listDeletedByTenant('tenant-a')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id, deletedAt: expect.any(String) })]),
    );
    await expect(repository.listFilesIncludingDeleted('tenant-a', id)).resolves.toMatchObject([
      { id: fileId },
    ]);

    await expect(repository.restore('tenant-b', id)).resolves.toBeNull();
    await expect(repository.restore('tenant-a', id)).resolves.toMatchObject({ id, deletedAt: null });
    await expect(repository.findById('tenant-a', id)).resolves.toMatchObject({ id, deletedAt: null });
    await expect(repository.delete('tenant-a', id)).resolves.toBe(true);
    await expect(repository.purge('tenant-a', id)).resolves.toBe(true);
    await expect(repository.purge('tenant-a', id)).resolves.toBe(false);
    await expect(repository.findAnyById('tenant-a', id)).resolves.toBeNull();
    await expect(repository.listFilesIncludingDeleted('tenant-a', id)).resolves.toEqual([]);
  });
});

describe('ApiTokenRepository', () => {
  it('round-trips tokens without hashes in list responses and resolves only active hashes', async () => {
    const repository = createApiTokenRepository(db);
    const created = await repository.create({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: 'user-owner',
      name: 'Importer',
      tokenHash: 'hash-secret',
      scopes: ['read', 'write:draft'],
    });

    expect(created).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Importer',
      scopes: ['read', 'write:draft'],
    });
    await expect(repository.listByUser('user-owner')).resolves.toMatchObject([
      { id: created.id, name: 'Importer' },
    ]);
    expect(JSON.stringify(await repository.listByUser('user-owner'))).not.toContain('hash-secret');
    await expect(repository.findActiveByHash('hash-secret')).resolves.toMatchObject({
      token: { id: created.id, tokenHash: 'hash-secret' },
      user: { userId: 'user-owner', email: 'owner@example.com' },
    });
    await repository.markUsed(created.id);
    await expect(repository.listByUser('user-owner')).resolves.toMatchObject([
      { id: created.id, lastUsedAt: expect.any(String) },
    ]);
    await expect(repository.revoke('user-admin', created.id)).resolves.toBe(false);
    await expect(repository.revoke('user-owner', created.id)).resolves.toBe(true);
    await expect(repository.findActiveByHash('hash-secret')).resolves.toBeNull();
  });
});

describe('UserPreferenceRepository', () => {
  it('upserts preferences by user and key', async () => {
    const repository = createUserPreferenceRepository(db);

    await expect(repository.get('user-owner', 'documents.columns')).resolves.toBeNull();
    await expect(
      repository.set('user-owner', 'documents.columns', {
        order: ['title'],
        visible: ['title'],
      }),
    ).resolves.toMatchObject({
      userId: 'user-owner',
      key: 'documents.columns',
      value: { order: ['title'], visible: ['title'] },
      updatedAt: expect.any(String),
    });
    await expect(repository.get('user-admin', 'documents.columns')).resolves.toBeNull();
    await expect(
      repository.set('user-owner', 'documents.columns', {
        order: ['documentDate', 'title'],
        visible: ['documentDate'],
      }),
    ).resolves.toMatchObject({
      value: { order: ['documentDate', 'title'], visible: ['documentDate'] },
    });
    await expect(repository.get('user-owner', 'documents.columns')).resolves.toMatchObject({
      value: { order: ['documentDate', 'title'], visible: ['documentDate'] },
    });
  });
});

describe('TenantSettingsRepository', () => {
  it('upserts the setting by tenant without leaking across tenants', async () => {
    const repository = createTenantSettingsRepository(db);

    await expect(repository.get('tenant-a')).resolves.toBeNull();
    await expect(repository.set('tenant-a', false)).resolves.toEqual({
      tenantId: 'tenant-a',
      storeSignatureRecords: false,
    });
    await expect(repository.get('tenant-b')).resolves.toBeNull();
    await expect(repository.set('tenant-a', true)).resolves.toEqual({
      tenantId: 'tenant-a',
      storeSignatureRecords: true,
    });
  });
});

describe('SignatureRecordRepository', () => {
  it('round-trips tenant-scoped records and cascades them on document purge', async () => {
    const documents = createDocumentRepository(db);
    const repository = createSignatureRecordRepository(db);
    const documentId = '23232323-2323-4232-8232-232323232323';
    const fileId = '24242424-2424-4242-8242-242424242424';
    await documents.create({
      id: documentId,
      tenantId: 'tenant-a',
      title: 'Zapis podpisu',
      docType: 'umowa-uod',
      documentDate: '2026-08-07',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: ['signature-record-itest'],
    });
    await documents.createFile('tenant-a', {
      id: fileId,
      documentId,
      role: 'signed-digital',
      fileName: 'podpisany.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/signature-record-itest/file',
    });
    const payload = [
      {
        strokes: [
          {
            points: [{ x: 0.2, y: 0.3, pressure: 0.8 }],
            simulatePressure: false,
          },
        ],
        pageIndex: 0,
        placement: { offsetX: 0.1, offsetY: 0.2, scale: 1.1 },
        inkColor: 'black' as const,
        inkSize: 2,
      },
    ];
    const input = {
      id: '25252525-2525-4252-8252-252525252525',
      tenantId: 'tenant-a',
      documentId,
      fileId,
      signedBy: 'user-owner',
      payload,
    };

    await expect(repository.create(input)).resolves.toMatchObject({
      ...input,
      createdAt: expect.any(String),
    });
    await expect(repository.create(input)).resolves.toBeNull();
    await expect(
      repository.listByDocument('tenant-b', documentId, null, 10),
    ).resolves.toEqual([]);
    await expect(
      repository.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toMatchObject([{ id: input.id, payload }]);

    await expect(documents.purge('tenant-a', documentId)).resolves.toBe(true);
    await expect(
      repository.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toEqual([]);
  });
});

describe('SourceUpdateRequestRepository', () => {
  it('enforces one pending request and atomically promotes files and re-points records', async () => {
    const documents = createDocumentRepository(db);
    const signatures = createSignatureRecordRepository(db);
    const requests = createSourceUpdateRequestRepository(db);
    const documentId = '10101010-1010-4010-8010-101010101010';
    const sourceFileId = '20202020-2020-4020-8020-202020202020';
    const signedFileId = '30303030-3030-4030-8030-303030303030';
    const stagedSourceFileId = '40404040-4040-4040-8040-404040404040';
    const stagedSignedFileId = '50505050-5050-4050-8050-505050505050';
    const requestId = '60606060-6060-4060-8060-606060606060';
    await documents.create({
      id: documentId,
      tenantId: 'tenant-a',
      title: 'Aktualizacja źródła',
      docType: 'umowa-uod',
      documentDate: '2026-08-08',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: ['source-update-itest'],
    });
    for (const input of [
      { id: sourceFileId, role: 'source' as const },
      { id: signedFileId, role: 'signed-digital' as const },
      { id: stagedSourceFileId, role: 'other' as const },
      { id: stagedSignedFileId, role: 'other' as const },
    ]) {
      await documents.createFile('tenant-a', {
        ...input,
        documentId,
        fileName: `${input.id}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 3,
        storageKey: `documents/tenant-a/source-update/${input.id}`,
      });
    }
    await signatures.create({
      id: '70707070-7070-4070-8070-707070707070',
      tenantId: 'tenant-a',
      documentId,
      fileId: signedFileId,
      signedBy: 'user-admin',
      payload: [
        {
          strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
          pageIndex: 0,
          placement: { offsetX: 0, offsetY: 0, scale: 1 },
          inkColor: 'black',
          inkSize: 2,
        },
      ],
    });
    await expect(
      requests.create({
        id: requestId,
        tenantId: 'tenant-a',
        documentId,
        requestedBy: 'user-owner',
        newSourceFileId: stagedSourceFileId,
        mode: 'transfer',
        approvalIds: [
          {
            id: '80808080-8080-4080-8080-808080808080',
            approverId: 'user-admin',
          },
        ],
      }),
    ).resolves.toMatchObject({
      id: requestId,
      approvals: [{ approverId: 'user-admin', decision: 'pending' }],
    });
    await expect(
      requests.create({
        id: '90909090-9090-4090-8090-909090909090',
        tenantId: 'tenant-a',
        documentId,
        requestedBy: 'user-owner',
        newSourceFileId: stagedSourceFileId,
        mode: 'delete-signed',
        approvalIds: [],
      }),
    ).resolves.toBeNull();
    await expect(
      requests.listPendingByApprover('tenant-a', 'user-admin'),
    ).resolves.toMatchObject([{ id: requestId }]);
    await expect(documents.findById('tenant-a', documentId)).resolves.toMatchObject({
      id: documentId,
    });
    await expect(documents.listFiles('tenant-a', documentId)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: stagedSourceFileId })]),
    );
    await expect(
      documents.listFilesIncludingDeleted('tenant-a', documentId),
    ).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: stagedSourceFileId })]),
    );
    await expect(
      documents.listAllFilesIncludingDeleted('tenant-a', documentId),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: stagedSourceFileId })]),
    );
    await expect(
      requests.decide('tenant-a', requestId, 'user-admin', 'accepted'),
    ).resolves.toMatchObject({ approvals: [{ decision: 'accepted' }] });
    await expect(
      requests.complete({
        tenantId: 'tenant-a',
        requestId,
        completedBy: 'user-admin',
        signedFileId: stagedSignedFileId,
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(documents.listFiles('tenant-a', documentId)).resolves.toMatchObject([
      { id: stagedSourceFileId, role: 'source' },
      { id: stagedSignedFileId, role: 'signed-digital' },
    ]);
    await expect(
      signatures.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toMatchObject([{ fileId: stagedSignedFileId, signedBy: 'user-admin' }]);
    const stored = await db
      .select()
      .from(schema.sourceUpdateRequests)
      .where(eq(schema.sourceUpdateRequests.id, requestId));
    expect(stored[0]).toMatchObject({
      priorSourceFileIds: [sourceFileId],
      priorSignedFileIds: [signedFileId],
      resolvedBy: 'user-admin',
      resolvedAt: expect.any(Date),
    });
  });
});

describe('PadSessionRepository', () => {
  it('round-trips request, submit, consume and close by tenant', async () => {
    const repository = createPadSessionRepository(db);
    const session = await repository.create({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      tenantId: 'tenant-a',
      createdBy: 'user-owner',
      secretHash: 'hash:pad_secret',
      expiresAt: '2026-08-04T14:00:00.000Z',
    });
    expect(session).toMatchObject({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      tenantId: 'tenant-a',
      createdBy: 'user-owner',
      status: 'active',
      lastPolledAt: null,
      currentRequest: null,
      submittedStrokes: null,
    });
    expect(await repository.findById('tenant-b', session.id)).toBeNull();
    await expect(repository.findActiveByUser('tenant-a', 'user-owner')).resolves.toMatchObject({
      id: session.id,
    });

    await expect(
      repository.renew(
        'tenant-a',
        session.id,
        '2026-08-04T15:00:00.000Z',
        '2026-08-04T11:00:00.000Z',
      ),
    ).resolves.toMatchObject({
      expiresAt: '2026-08-04T15:00:00.000Z',
      lastPolledAt: '2026-08-04T11:00:00.000Z',
    });

    const requested = await repository.requestSignature('tenant-a', session.id, {
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      documentTitle: 'Umowa',
    });
    expect(requested).toMatchObject({
      currentRequest: {
        requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        documentTitle: 'Umowa',
      },
    });

    const strokes = {
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      inkColor: 'black' as const,
      sourceSize: { width: 834, height: 620 },
      strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
    };
    await expect(repository.submitStrokes('tenant-a', session.id, strokes)).resolves.toMatchObject({
      submittedStrokes: strokes,
    });
    await expect(repository.consumeStrokes('tenant-b', session.id)).resolves.toBeNull();
    await expect(repository.consumeStrokes('tenant-a', session.id)).resolves.toEqual(strokes);
    await expect(repository.consumeStrokes('tenant-a', session.id)).resolves.toBeNull();
    await expect(repository.close('tenant-a', session.id)).resolves.toBe(true);
    await expect(repository.findById('tenant-a', session.id)).resolves.toMatchObject({
      status: 'closed',
      currentRequest: null,
      submittedStrokes: null,
    });
    await expect(repository.findActiveByUser('tenant-a', 'user-owner')).resolves.toBeNull();
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
        `INSERT INTO tenant_settings (tenant_id, store_signature_records)
         VALUES ($1, true)`,
        [`tenant-${suffix}`],
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
      await pool.query(
        `INSERT INTO signature_records
           (id, tenant_id, document_id, file_id, signed_by, payload)
         VALUES ($1, $2, $3, $4, $5, '[{"strokes":[{"points":[{"x":0.1,"y":0.2,"pressure":0.5}]}],"pageIndex":0,"placement":{"offsetX":0,"offsetY":0,"scale":1},"inkColor":"black","inkSize":2}]'::jsonb)`,
        [
          suffix === 'offboard'
            ? 'abababab-abab-4bab-8bab-abababababab'
            : 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
          `tenant-${suffix}`,
          suffix === 'offboard'
            ? '77777777-7777-4777-8777-777777777777'
            : '88888888-8888-4888-8888-888888888888',
          suffix === 'offboard'
            ? '99999999-9999-4999-8999-999999999999'
            : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          `user-${suffix}`,
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
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_settings WHERE tenant_id = 'tenant-offboard'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM signature_records WHERE tenant_id = 'tenant-offboard'`,
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
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM tenant_settings WHERE tenant_id = 'tenant-sibling'`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM signature_records WHERE tenant_id = 'tenant-sibling'`,
      ),
    ]);

    expect(removed.map((result) => result.rows[0]?.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(sibling.map((result) => result.rows[0]?.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});
