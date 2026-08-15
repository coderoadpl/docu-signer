import { and, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, notExists, sql, type SQL } from 'drizzle-orm';

import {
  documentFileSchema,
  documentSchema,
  documentWithSignersSchema,
  type Document,
  type DocumentFile,
  type DocumentWithSigners,
} from '#core/domain/index.js';
import type { DocumentRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import {
  documentFiles,
  documents,
  signatureRecords,
  sourceUpdateRequests,
} from './schema.js';

const toDocument = (row: typeof documents.$inferSelect): Document =>
  documentSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  });

const toDocumentFile = (
  row: typeof documentFiles.$inferSelect,
  sealed?: unknown,
): DocumentFile =>
  documentFileSchema.parse({ ...row, sealed, createdAt: row.createdAt.toISOString() });

const toDocumentWithSigners = (row: {
  document: typeof documents.$inferSelect;
  signers: unknown;
}): DocumentWithSigners =>
  documentWithSignersSchema.parse({
    ...toDocument(row.document),
    signers: row.signers,
  });

const documentSigners = sql<unknown>`
  coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object('accountId', contributor.account_id, 'name', contributor.name)
        ORDER BY contributor.name, contributor.account_id
      )
      FROM (
        SELECT DISTINCT
          coalesce(stamp.value ->> 'contributedBy', record.signed_by) AS account_id,
          account.name AS name
        FROM signature_records record
        CROSS JOIN LATERAL jsonb_array_elements(
          coalesce(record.payload, '[]'::jsonb)
        ) AS stamp(value)
        INNER JOIN tenant_admins grant_row
          ON grant_row.tenant_id = record.tenant_id
          AND grant_row.user_id = coalesce(
            stamp.value ->> 'contributedBy',
            record.signed_by
          )
        INNER JOIN "user" account ON account.id = grant_row.user_id
        WHERE record.tenant_id = documents.tenant_id
          AND record.document_id = documents.id
      ) contributor
    ),
    '[]'::jsonb
  )
`.as('signers');

export const createDocumentRepository = (db: Db): DocumentRepository => ({
  listByTenant: async (tenantId, filter) => {
    const conditions: SQL[] = [eq(documents.tenantId, tenantId), isNull(documents.deletedAt)];
    const hasSourceFile = exists(
      db
        .select({ id: documentFiles.id })
        .from(documentFiles)
        .where(
          and(
            eq(documentFiles.documentId, documents.id),
            eq(documentFiles.role, 'source'),
          ),
        ),
    );
    const hasSignedFile = exists(
      db
        .select({ id: documentFiles.id })
        .from(documentFiles)
        .where(
          and(
            eq(documentFiles.documentId, documents.id),
            inArray(documentFiles.role, ['signed-scan', 'signed-digital']),
          ),
        ),
    );
    if (filter.docType) conditions.push(eq(documents.docType, filter.docType));
    if (filter.person) conditions.push(ilike(documents.person, `%${filter.person}%`));
    if (filter.tag) conditions.push(sql`${documents.tags} @> ${JSON.stringify([filter.tag])}::jsonb`);
    if (filter.text) conditions.push(ilike(documents.title, `%${filter.text}%`));
    if (filter.dateFrom) {
      conditions.push(sql`coalesce(${documents.periodEnd}, ${documents.documentDate}) >= ${filter.dateFrom}`);
    }
    if (filter.dateTo) {
      conditions.push(sql`coalesce(${documents.periodStart}, ${documents.documentDate}) <= ${filter.dateTo}`);
    }
    if (filter.signatureStatus === 'needs-signature') {
      conditions.push(sql`${hasSourceFile} AND NOT ${hasSignedFile}`);
    }
    if (filter.signatureStatus === 'signed') {
      conditions.push(hasSignedFile);
    }
    if (filter.signerAccountId) {
      conditions.push(sql`exists (
        SELECT 1
        FROM signature_records record
        CROSS JOIN LATERAL jsonb_array_elements(
          coalesce(record.payload, '[]'::jsonb)
        ) AS stamp(value)
        INNER JOIN tenant_admins grant_row
          ON grant_row.tenant_id = record.tenant_id
          AND grant_row.user_id = coalesce(
            stamp.value ->> 'contributedBy',
            record.signed_by
          )
        WHERE record.tenant_id = documents.tenant_id
          AND record.document_id = documents.id
          AND grant_row.user_id = ${filter.signerAccountId}
      )`);
    }
    if (filter.draft === 'true') conditions.push(eq(documents.draft, true));
    if (filter.draft === undefined || filter.draft === 'false') {
      conditions.push(eq(documents.draft, false));
    }
    const rows = await db
      .select({ document: documents, signers: documentSigners })
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt));
    return rows.map(toDocumentWithSigners);
  },
  listDeletedByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), isNotNull(documents.deletedAt)))
      .orderBy(desc(documents.deletedAt), desc(documents.documentDate), desc(documents.createdAt));
    return rows.map(toDocument);
  },
  findById: async (tenantId, documentId) => {
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toDocument(rows[0]) : null;
  },
  findDeletedById: async (tenantId, documentId) => {
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNotNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toDocument(rows[0]) : null;
  },
  findAnyById: async (tenantId, documentId) => {
    const rows = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
        ),
      )
      .limit(1);
    return rows[0] ? toDocument(rows[0]) : null;
  },
  listFiles: async (tenantId, documentId) => {
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
          notExists(
            db
              .select({ id: sourceUpdateRequests.id })
              .from(sourceUpdateRequests)
              .where(
                and(
                  eq(sourceUpdateRequests.newSourceFileId, documentFiles.id),
                  ne(sourceUpdateRequests.status, 'completed'),
                ),
              ),
          ),
        ),
      )
      .orderBy(documentFiles.createdAt);
    return rows.map((row) => toDocumentFile(row.file));
  },
  listFilesIncludingDeleted: async (tenantId, documentId) => {
    const rows = await db
      .select({
        file: documentFiles,
        sealed: exists(
          db
            .select({ id: signatureRecords.id })
            .from(signatureRecords)
            .where(
              and(
                eq(signatureRecords.tenantId, documents.tenantId),
                eq(signatureRecords.documentId, documents.id),
                eq(signatureRecords.fileId, documentFiles.id),
                isNotNull(signatureRecords.sealSubject),
              ),
            ),
        ),
      })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          notExists(
            db
              .select({ id: sourceUpdateRequests.id })
              .from(sourceUpdateRequests)
              .where(
                and(
                  eq(sourceUpdateRequests.newSourceFileId, documentFiles.id),
                  ne(sourceUpdateRequests.status, 'completed'),
                ),
              ),
          ),
        ),
      )
      .orderBy(documentFiles.createdAt);
    return rows.map((row) => toDocumentFile(row.file, row.sealed));
  },
  listAllFilesIncludingDeleted: async (tenantId, documentId) => {
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .orderBy(documentFiles.createdAt);
    return rows.map((row) => toDocumentFile(row.file));
  },
  listFilesForDocuments: async (tenantId, documentIds) => {
    if (documentIds.length === 0) return [];
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(
        and(
          eq(documents.tenantId, tenantId),
          inArray(documents.id, documentIds),
          isNull(documents.deletedAt),
          notExists(
            db
              .select({ id: sourceUpdateRequests.id })
              .from(sourceUpdateRequests)
              .where(
                and(
                  eq(sourceUpdateRequests.newSourceFileId, documentFiles.id),
                  ne(sourceUpdateRequests.status, 'completed'),
                ),
              ),
          ),
        ),
      )
      .orderBy(documentFiles.createdAt);
    return rows.map((row) => toDocumentFile(row.file));
  },
  create: async (input) => {
    const rows = await db.insert(documents).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Document insert returned no row');
    return toDocument(row);
  },
  update: async (tenantId, documentId, input) => {
    const rows = await db
      .update(documents)
      .set({ ...input, updatedAt: sql`now()` })
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .returning();
    return rows[0] ? toDocument(rows[0]) : null;
  },
  approve: async (tenantId, documentId) => {
    const rows = await db
      .update(documents)
      .set({ draft: false, updatedAt: sql`now()` })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .returning();
    return rows[0] ? toDocument(rows[0]) : null;
  },
  unapprove: async (tenantId, documentId) => {
    const rows = await db
      .update(documents)
      .set({ draft: true, updatedAt: sql`now()` })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .returning();
    return rows[0] ? toDocument(rows[0]) : null;
  },
  delete: async (tenantId, documentId) => {
    const rows = await db
      .update(documents)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .returning({ id: documents.id });
    return rows.length > 0;
  },
  restore: async (tenantId, documentId) => {
    const rows = await db
      .update(documents)
      .set({ deletedAt: null, updatedAt: sql`now()` })
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          isNotNull(documents.deletedAt),
        ),
      )
      .returning();
    return rows[0] ? toDocument(rows[0]) : null;
  },
  purge: async (tenantId, documentId) => {
    const rows = await db
      .delete(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .returning({ id: documents.id });
    return rows.length > 0;
  },
  createFile: async (tenantId, input) => {
    const rows = await db
      .insert(documentFiles)
      .select(
        db
          .select({
            id: sql<string>`${input.id}::uuid`.as('id'),
            documentId: documents.id,
            role: sql<typeof input.role>`${input.role}`.as('role'),
            fileName: sql<string>`${input.fileName}`.as('file_name'),
            contentType: sql<string>`${input.contentType}`.as('content_type'),
            sizeBytes: sql<number>`${input.sizeBytes}`.as('size_bytes'),
            storageKey: sql<string>`${input.storageKey}`.as('storage_key'),
            createdAt: sql<Date>`now()`.as('created_at'),
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, input.documentId),
              eq(documents.tenantId, tenantId),
              isNull(documents.deletedAt),
            ),
          ),
      )
      .returning();
    return rows[0] ? toDocumentFile(rows[0]) : null;
  },
  updateFileSize: async (tenantId, documentId, fileId, sizeBytes) => {
    const rows = await db
      .update(documentFiles)
      .set({ sizeBytes })
      .where(
        and(
          eq(documentFiles.id, fileId),
          eq(documentFiles.documentId, documentId),
          exists(
            db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(
                  eq(documents.id, documentId),
                  eq(documents.tenantId, tenantId),
                ),
              ),
          ),
        ),
      )
      .returning({ id: documentFiles.id });
    return rows.length > 0;
  },
  findFile: async (tenantId, documentId, fileId) => {
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, documentId),
          eq(documentFiles.id, fileId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toDocumentFile(rows[0].file) : null;
  },
  moveFileToDocument: async (tenantId, sourceDocumentId, fileId, targetDocumentId) => {
    const rows = await db
      .update(documentFiles)
      .set({ documentId: targetDocumentId })
      .where(
        and(
          eq(documentFiles.id, fileId),
          eq(documentFiles.documentId, sourceDocumentId),
          exists(
            db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(
                  eq(documents.id, sourceDocumentId),
                  eq(documents.tenantId, tenantId),
                  isNull(documents.deletedAt),
                ),
              ),
          ),
          exists(
            db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(
                  eq(documents.id, targetDocumentId),
                  eq(documents.tenantId, tenantId),
                  isNull(documents.deletedAt),
                ),
              ),
          ),
        ),
      )
      .returning();
    return rows[0] ? toDocumentFile(rows[0]) : null;
  },
  deleteFile: async (tenantId, documentId, fileId) => {
    const rows = await db
      .delete(documentFiles)
      .where(
        and(
          eq(documentFiles.id, fileId),
          eq(documentFiles.documentId, documentId),
          exists(
            db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(
                  eq(documents.id, documentFiles.documentId),
                  eq(documents.tenantId, tenantId),
                  isNull(documents.deletedAt),
                ),
              ),
          ),
        ),
      )
      .returning({ id: documentFiles.id });
    return rows.length > 0;
  },
});
