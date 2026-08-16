import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDocumentRepository } from './documents-repository.js';
import { createDocumentCommentRepository } from './document-comments-repository.js';
import { createDocumentLinkRepository } from './document-links-repository.js';
import { createPadSessionRepository } from './pad-sessions-repository.js';
import { createApiTokenRepository } from './api-tokens-repository.js';
import { createInvitationRepository } from './invitations-repository.js';
import { createTenantAccessReader } from './repositories.js';
import { createSavedSearchRepository } from './saved-searches-repository.js';
import { createUserPreferenceRepository } from './user-preferences-repository.js';
import { createTenantSettingsRepository } from './tenant-settings-repository.js';
import { createTenantAccountRepository } from './tenant-accounts-repository.js';
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

describe('InvitationRepository', () => {
  it('replaces one pending invite, isolates tenants, revokes, and accepts into a grant', async () => {
    const repository = createInvitationRepository(db);
    const first = await repository.createOrReplace({
      id: '90909090-9090-4090-8090-909090909090',
      tenantId: 'tenant-a',
      email: 'invited@example.com',
      role: 'admin',
      tokenHash: 'first-hash',
      invitedBy: 'user-owner',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    expect(first.status).toBe('pending');
    const replaced = await repository.createOrReplace({
      id: '91919191-9191-4191-8191-919191919191',
      tenantId: 'tenant-a',
      email: 'invited@example.com',
      role: 'owner',
      tokenHash: 'second-hash',
      invitedBy: 'user-owner',
      expiresAt: '2026-08-17T11:00:00.000Z',
    });
    expect(replaced.id).toBe('91919191-9191-4191-8191-919191919191');
    expect(await repository.listByTenant('tenant-a')).toHaveLength(1);
    expect(await repository.listByTenant('tenant-b')).toEqual([]);
    expect(await repository.findByTokenHash('first-hash')).toBeNull();
    await expect(repository.findByTokenHash('second-hash')).resolves.toMatchObject({
      email: 'invited@example.com',
      organizationName: 'A',
      tokenHash: 'second-hash',
    });
    expect(await repository.revoke('tenant-b', replaced.id)).toBe(false);
    expect(await repository.revoke('tenant-a', replaced.id)).toBe(true);

    await repository.createOrReplace({
      id: '92929292-9292-4292-8292-929292929292',
      tenantId: 'tenant-a',
      email: 'admin@example.com',
      role: 'admin',
      tokenHash: 'accept-hash',
      invitedBy: 'user-owner',
      expiresAt: '2026-08-17T10:00:00.000Z',
    });
    expect(await repository.hasAccount('admin@example.com')).toBe(true);
    expect(await repository.accept('92929292-9292-4292-8292-929292929292', 'user-admin')).toBe(true);
    expect(await repository.accept('92929292-9292-4292-8292-929292929292', 'user-admin')).toBe(false);
    await expect(repository.listByTenant('tenant-a')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'accepted' })]),
    );
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
    await expect(repository.unapprove('tenant-a', draft.id)).resolves.toMatchObject({
      draft: true,
    });
    await expect(repository.listByTenant('tenant-a', { draft: 'true' })).resolves.toMatchObject([
      { title: 'Szkic', draft: true },
    ]);
    await repository.approve('tenant-a', draft.id);
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

  it('projects seal presence onto detail files without seal metadata', async () => {
    const documents = createDocumentRepository(db);
    const signatures = createSignatureRecordRepository(db);
    const signedFileId = '23232323-2323-4323-8323-232323232323';
    await documents.createFile('tenant-a', {
      id: signedFileId,
      documentId: '11111111-1111-4111-8111-111111111111',
      role: 'signed-digital',
      fileName: 'umowa-podpisana.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/document/signed-file',
    });
    await signatures.recordSeal({
      id: '24242424-2424-4424-8424-242424242424',
      tenantId: 'tenant-a',
      documentId: '11111111-1111-4111-8111-111111111111',
      fileId: signedFileId,
      signedBy: 'user-owner',
      seal: {
        subject: 'CN=Agentproofarch',
        declaredAt: '2026-08-01T10:00:00.000Z',
        appliedAt: '2026-08-01T10:00:01.000Z',
      },
    });

    await expect(
      documents.listFilesIncludingDeleted(
        'tenant-a',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '22222222-2222-4222-8222-222222222222',
          sealed: false,
        }),
        expect.objectContaining({ id: signedFileId, sealed: true }),
      ]),
    );
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
    await repository.create({
      id: '20202020-2020-4202-8202-202020202020',
      tenantId: 'tenant-a',
      title: 'Nie wymaga',
      docType: 'rachunek',
      documentDate: '2026-07-31',
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
    await repository.createFile('tenant-a', {
      id: '21212121-2121-4212-8212-212121212121',
      documentId: '20202020-2020-4202-8202-202020202020',
      role: 'source',
      fileName: 'rachunek.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/status/waived/source',
    });
    await expect(
      repository.waiveSignature('tenant-a', '20202020-2020-4202-8202-202020202020'),
    ).resolves.toMatchObject({ signatureNotRequired: true });
    await repository.waiveSignature('tenant-a', '13131313-1313-4131-8131-131313131313');

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
    await expect(
      repository.listByTenant('tenant-a', {
        tag: 'status-filter',
        signatureStatus: 'not-required',
      }),
    ).resolves.toMatchObject([{ title: 'Nie wymaga' }]);
    await expect(
      repository.requireSignature('tenant-a', '20202020-2020-4202-8202-202020202020'),
    ).resolves.toMatchObject({ signatureNotRequired: false });
  });

  it('aggregates distinct signer accounts and filters without crossing tenants', async () => {
    const repository = createDocumentRepository(db);
    const signatures = createSignatureRecordRepository(db);
    await db.insert(user).values({
      id: 'user-cosigner',
      email: 'cosigner@example.com',
      name: 'Maria Choma',
    });
    await db.insert(tenantAdmins).values({
      id: 'grant-cosigner',
      tenantId: 'tenant-a',
      userId: 'user-cosigner',
      role: 'admin',
    });
    await db.insert(user).values({
      id: 'user-foreign-signer',
      email: 'foreign-signer@example.com',
      name: 'Foreign Signer',
    });
    await db.insert(tenantAdmins).values({
      id: 'grant-foreign-signer',
      tenantId: 'tenant-b',
      userId: 'user-foreign-signer',
      role: 'admin',
    });
    const signedDocumentId = '31313131-3131-4313-8313-313131313131';
    const unsignedDocumentId = '32323232-3232-4323-8323-323232323232';
    const signedFileId = '33333333-3333-4333-8333-333333333333';
    for (const input of [
      { id: signedDocumentId, title: 'Z podpisami' },
      { id: unsignedDocumentId, title: 'Bez zapisu podpisu' },
    ]) {
      await repository.create({
        ...input,
        tenantId: 'tenant-a',
        docType: 'umowa-uod',
        documentDate: '2026-08-05',
        periodStart: null,
        periodEnd: null,
        person: null,
        tags: ['signer-attribution'],
      });
    }
    await repository.createFile('tenant-a', {
      id: signedFileId,
      documentId: signedDocumentId,
      role: 'signed-digital',
      fileName: 'podpisany.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-a/signer-attribution/signed',
    });
    const stamp = {
      strokes: [{ points: [{ x: 0.2, y: 0.3, pressure: 0.8 }] }],
      pageIndex: 0,
      placement: { offsetX: 0.1, offsetY: 0.2, scale: 1 },
      inkColor: 'black' as const,
      inkSize: 2,
    };
    await signatures.create({
      id: '34343434-3434-4343-8343-343434343434',
      tenantId: 'tenant-a',
      documentId: signedDocumentId,
      fileId: signedFileId,
      signedBy: 'user-owner',
      payload: [
        stamp,
        { ...stamp, contributedBy: 'user-owner' },
        { ...stamp, contributedBy: 'user-cosigner' },
        { ...stamp, contributedBy: 'user-foreign-signer' },
      ],
    });

    await expect(
      repository.listByTenant('tenant-a', { tag: 'signer-attribution', draft: 'all' }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: signedDocumentId,
          signers: [
            { accountId: 'user-cosigner', name: 'Maria Choma' },
            { accountId: 'user-owner', name: 'Owner' },
          ],
        }),
        expect.objectContaining({ id: unsignedDocumentId, signers: [] }),
      ]),
    );
    await expect(
      repository.listByTenant('tenant-a', {
        tag: 'signer-attribution',
        signerAccountId: 'user-cosigner',
        draft: 'all',
      }),
    ).resolves.toMatchObject([{ id: signedDocumentId }]);
    await expect(
      repository.listByTenant('tenant-a', {
        tag: 'signer-attribution',
        signerAccountId: 'user-foreign-signer',
        draft: 'all',
      }),
    ).resolves.toEqual([]);
    await expect(
      createTenantAccountRepository(db).listByTenant('tenant-a'),
    ).resolves.toEqual([
      { accountId: 'user-admin', name: 'Admin' },
      { accountId: 'user-cosigner', name: 'Maria Choma' },
      { accountId: 'user-owner', name: 'Owner' },
    ]);
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

describe('DocumentCommentRepository', () => {
  it('round-trips attributed comments, enforces tenant scope and body constraints, and cascades on purge', async () => {
    const documents = createDocumentRepository(db);
    const comments = createDocumentCommentRepository(db);
    const documentId = '31313131-3131-4131-8131-313131313131';
    const firstCommentId = '32323232-3232-4232-8232-323232323232';
    const secondCommentId = '33323232-3232-4232-8232-323232323232';
    await documents.create({
      id: documentId,
      tenantId: 'tenant-a',
      title: 'Komentowana umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-16',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: ['comments-itest'],
    });

    await expect(
      comments.create({
        id: firstCommentId,
        tenantId: 'tenant-a',
        documentId,
        authorAccountId: 'user-owner',
        body: 'Pierwszy komentarz',
      }),
    ).resolves.toMatchObject({
      id: firstCommentId,
      author: { accountId: 'user-owner', name: 'Owner' },
      body: 'Pierwszy komentarz',
      createdAt: expect.any(String),
    });
    await comments.create({
      id: secondCommentId,
      tenantId: 'tenant-a',
      documentId,
      authorAccountId: 'user-owner',
      body: 'Drugi komentarz',
    });

    await expect(
      comments.listByDocument('tenant-b', documentId, null, 10),
    ).resolves.toEqual([]);
    await expect(
      comments.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toMatchObject([
      { id: firstCommentId, author: { name: 'Owner' } },
      { id: secondCommentId, author: { name: 'Owner' } },
    ]);
    await expect(
      comments.findById('tenant-b', documentId, firstCommentId),
    ).resolves.toBeNull();
    await expect(
      comments.delete('tenant-b', documentId, firstCommentId),
    ).resolves.toBe(false);
    await expect(
      pool.query(
        `INSERT INTO document_comments
           (id, tenant_id, document_id, author_account_id, body)
         VALUES
           ('34343434-3434-4434-8434-343434343434', 'tenant-a', $1, 'user-owner', ' niepoprawny ')`,
        [documentId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      comments.delete('tenant-a', documentId, firstCommentId),
    ).resolves.toBe(true);
    await expect(documents.purge('tenant-a', documentId)).resolves.toBe(true);
    await expect(
      comments.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toEqual([]);
  });
});

describe('DocumentLinkRepository', () => {
  it('round-trips bidirectional display, preserves trash state, and enforces tenant pairs', async () => {
    const documents = createDocumentRepository(db);
    const links = createDocumentLinkRepository(db);
    const first = await documents.create({
      id: '70707070-7070-4070-8070-707070707070',
      tenantId: 'tenant-a',
      title: 'Umowa ramowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-16',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
    });
    const second = await documents.create({
      id: '71717171-7171-4171-8171-717171717171',
      tenantId: 'tenant-a',
      title: 'Uchwała pełnomocnika',
      docType: 'uchwala',
      documentDate: '2026-08-16',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
    });
    const otherTenant = await documents.create({
      id: '72727272-7272-4272-8272-727272727272',
      tenantId: 'tenant-b',
      title: 'Obcy dokument',
      docType: 'inny',
      documentDate: '2026-08-16',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
    });

    await expect(
      links.create('tenant-a', {
        id: '73737373-7373-4373-8373-737373737373',
        fromDocumentId: first.id,
        toDocumentId: second.id,
        label: 'podstawa',
      }),
    ).resolves.toMatchObject({ label: 'podstawa' });
    await expect(links.listForDocument('tenant-a', first.id)).resolves.toMatchObject([
      { label: 'podstawa', document: { id: second.id, deletedAt: null } },
    ]);
    await expect(links.listForDocument('tenant-a', second.id)).resolves.toMatchObject([
      { label: 'podstawa', document: { id: first.id } },
    ]);
    await expect(links.findBetween('tenant-a', second.id, first.id)).resolves.toMatchObject({
      id: '73737373-7373-4373-8373-737373737373',
    });
    await expect(
      links.create('tenant-a', {
        id: '74747474-7474-4474-8474-747474747474',
        fromDocumentId: first.id,
        toDocumentId: second.id,
        label: null,
      }),
    ).resolves.toBeNull();
    await expect(links.listForDocument('tenant-b', first.id)).resolves.toEqual([]);
    await expect(
      links.create('tenant-a', {
        id: '75757575-7575-4575-8575-757575757575',
        fromDocumentId: first.id,
        toDocumentId: otherTenant.id,
        label: null,
      }),
    ).rejects.toThrow();
    await expect(
      links.create('tenant-a', {
        id: '76767676-7676-4676-8676-767676767676',
        fromDocumentId: first.id,
        toDocumentId: first.id,
        label: null,
      }),
    ).rejects.toThrow();

    await documents.delete('tenant-a', second.id);
    await expect(links.listForDocument('tenant-a', first.id)).resolves.toMatchObject([
      { document: { id: second.id, deletedAt: expect.any(String) } },
    ]);
    await expect(links.deleteBetween('tenant-a', second.id, first.id)).resolves.toBe(true);
    await expect(links.listForDocument('tenant-a', first.id)).resolves.toEqual([]);
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
    await expect(repository.set('tenant-a', {
      storeSignatureRecords: false,
      pdfSealEnabled: true,
      signatureBoxEnabled: true,
      dateMode: 'actual',
    })).resolves.toEqual({
      tenantId: 'tenant-a',
      storeSignatureRecords: false,
      pdfSealEnabled: true,
      signatureBoxEnabled: true,
      dateMode: 'actual',
    });
    await expect(repository.get('tenant-b')).resolves.toBeNull();
    await expect(repository.set('tenant-a', {
      storeSignatureRecords: true,
      pdfSealEnabled: false,
      signatureBoxEnabled: false,
      dateMode: 'declared',
    })).resolves.toEqual({
      tenantId: 'tenant-a',
      storeSignatureRecords: true,
      pdfSealEnabled: false,
      signatureBoxEnabled: false,
      dateMode: 'declared',
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

    await repository.recordSeal?.({
      id: input.id,
      tenantId: input.tenantId,
      documentId,
      fileId,
      signedBy: input.signedBy,
      seal: {
        subject: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
        declaredAt: '2020-02-03T14:15:16.000Z',
        appliedAt: '2026-08-09T14:15:16.789Z',
      },
    });
    await expect(
      repository.listByDocument('tenant-a', documentId, null, 10),
    ).resolves.toEqual([]);
    await expect(repository.create(input)).resolves.toMatchObject({
      ...input,
      seal: {
        subject: 'Amazing Company Sp. z o.o. — pieczęć dokumentowa',
        declaredAt: '2020-02-03T14:15:16.000Z',
        appliedAt: '2026-08-09T14:15:16.789Z',
      },
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
      mode: 'private',
      expiresAt: '2026-08-04T14:00:00.000Z',
    });
    expect(session).toMatchObject({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      tenantId: 'tenant-a',
      createdBy: 'user-owner',
      status: 'active',
      lastPolledAt: null,
      currentRequest: null,
      currentDocument: null,
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
      contributedBy: { accountId: 'user-owner', label: 'Owner' },
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

  it('tracks shared participants and queues document-bound submissions', async () => {
    const repository = createPadSessionRepository(db);
    const session = await repository.create({
      id: 'abababab-abab-4bab-8bab-abababababab',
      tenantId: 'tenant-a',
      createdBy: 'user-owner',
      secretHash: 'hash:shared_secret',
      mode: 'shared',
      expiresAt: '2099-08-04T14:00:00.000Z',
    });
    await repository.touchParticipant('tenant-a', session.id, {
      id: 'acacacac-acac-4cac-8cac-acacacacacac',
      accountId: 'user-owner',
      label: 'Owner',
      lastPolledAt: '2026-08-09T10:00:00.000Z',
    });
    await expect(repository.listParticipants('tenant-b', session.id)).resolves.toEqual([]);
    await expect(repository.listParticipants('tenant-a', session.id)).resolves.toEqual([
      {
        accountId: 'user-owner',
        label: 'Owner',
        lastPolledAt: '2026-08-09T10:00:00.000Z',
      },
    ]);

    const submission = {
      id: 'adadadad-adad-4dad-8dad-adadadadadad',
      requestId: 'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae',
      document: { key: 'document-a:file-a', title: 'Umowa' },
      inkColor: 'navy' as const,
      sourceSize: { width: 834, height: 620 },
      contributedBy: { accountId: 'user-owner', label: 'Owner' },
      strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
      createdAt: '2026-08-09T10:01:00.000Z',
    };
    await repository.requestSignature('tenant-a', session.id, {
      requestId: submission.requestId,
      documentTitle: 'Umowa',
    });
    await repository.enqueueSubmission('tenant-a', session.id, submission);
    await expect(repository.findById('tenant-a', session.id)).resolves.toMatchObject({
      currentRequest: null,
    });
    await expect(repository.listSubmissions('tenant-b', session.id)).resolves.toEqual([]);
    await expect(repository.listSubmissions('tenant-a', session.id)).resolves.toEqual([
      submission,
    ]);
    await expect(
      repository.consumeSubmission('tenant-a', session.id, submission.id),
    ).resolves.toEqual(submission);
    await expect(repository.listSubmissions('tenant-a', session.id)).resolves.toEqual([]);
    await repository.close('tenant-a', session.id);
    await expect(repository.listParticipants('tenant-a', session.id)).resolves.toEqual([]);
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
        `INSERT INTO tenant_settings (tenant_id, date_mode)
         VALUES ('tenant-constraints', 'inferred')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
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
