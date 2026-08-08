import { and, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  documentFileSchema,
  documentSchema,
  ok as resultOk,
  type Document,
  type DocumentFile,
} from '#core/domain/index.js';
import type { DocumentRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documentFiles, documents } from './schema.js';

const toDocument = (row: typeof documents.$inferSelect): Document =>
  documentSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

const toDocumentFile = (row: typeof documentFiles.$inferSelect): DocumentFile =>
  documentFileSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });

export const createDocumentRepository = (db: Db): DocumentRepository => ({
  listByTenant: async (tenantId, filter) => {
    const conditions: SQL[] = [eq(documents.tenantId, tenantId)];
    if (filter.docType) conditions.push(eq(documents.docType, filter.docType));
    if (filter.person) conditions.push(ilike(documents.person, `%${filter.person}%`));
    if (filter.text) conditions.push(ilike(documents.title, `%${filter.text}%`));
    if (filter.dateFrom) conditions.push(gte(documents.documentDate, filter.dateFrom));
    if (filter.dateTo) conditions.push(lte(documents.documentDate, filter.dateTo));
    const rows = await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt));
    return resultOk(rows.map(toDocument));
  },
  findById: async (tenantId, documentId) => {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .limit(1);
    return resultOk(rows[0] ? toDocument(rows[0]) : null);
  },
  listFiles: async (tenantId, documentId) => {
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .orderBy(documentFiles.createdAt);
    return resultOk(rows.map((row) => toDocumentFile(row.file)));
  },
  listFilesForDocuments: async (tenantId, documentIds) => {
    if (documentIds.length === 0) return resultOk([]);
    const rows = await db
      .select({ file: documentFiles })
      .from(documentFiles)
      .innerJoin(documents, eq(documentFiles.documentId, documents.id))
      .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, documentIds)))
      .orderBy(documentFiles.createdAt);
    return resultOk(rows.map((row) => toDocumentFile(row.file)));
  },
  create: async (input) => {
    const rows = await db.insert(documents).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Document insert returned no row');
    return resultOk(toDocument(row));
  },
  update: async (tenantId, documentId, input) => {
    const rows = await db
      .update(documents)
      .set({ ...input, updatedAt: sql`now()` })
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .returning();
    return resultOk(rows[0] ? toDocument(rows[0]) : null);
  },
  delete: async (tenantId, documentId) => {
    const rows = await db
      .delete(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
      .returning({ id: documents.id });
    return resultOk(rows.length > 0);
  },
  createFile: async (tenantId, input) => {
    const rows = zRows.parse(await db.execute(sql`
      INSERT INTO document_files
        (id, document_id, role, file_name, content_type, size_bytes, storage_key)
      SELECT
        ${input.id}::uuid,
        ${input.documentId}::uuid,
        ${input.role},
        ${input.fileName},
        ${input.contentType},
        ${input.sizeBytes},
        ${input.storageKey}
      FROM documents
      WHERE id = ${input.documentId}::uuid AND tenant_id = ${tenantId}
      RETURNING *
    `));
    if (rows.rows.length === 0) return resultOk(null);
    const inserted = await db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.id, input.id))
      .limit(1);
    const row = inserted[0];
    if (!row) throw new Error('Document file insert returned no row');
    return resultOk(toDocumentFile(row));
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
        ),
      )
      .limit(1);
    return resultOk(rows[0] ? toDocumentFile(rows[0].file) : null);
  },
  deleteFile: async (tenantId, documentId, fileId) => {
    const rows = zRows.parse(await db.execute(sql`
      DELETE FROM document_files AS f
      USING documents AS d
      WHERE f.id = ${fileId}::uuid
        AND f.document_id = ${documentId}::uuid
        AND d.id = f.document_id
        AND d.tenant_id = ${tenantId}
      RETURNING f.id
    `));
    return resultOk(rows.rows.length > 0);
  },
});

const zRows = z.object({ rows: z.array(z.unknown()) });
