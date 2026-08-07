import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';

import {
  documentFileSchema,
  documentSchema,
  err,
  internal,
  ok,
  type AppError,
  type Document,
  type DocumentFile,
  type Result,
} from '#core/domain/index.js';
import type { DocumentRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documentFiles, documents } from './schema.js';

const databaseResult = async <T>(operation: () => Promise<T>): Promise<Result<T, AppError>> => {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(internal(`Database operation failed: ${String(cause)}`));
  }
};

const toDocument = (row: typeof documents.$inferSelect): Document => {
  const parsed = documentSchema.safeParse({
    ...row,
    person: row.person ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  if (!parsed.success) throw new Error('Stored document is invalid');
  return parsed.data;
};

const toDocumentFile = (row: typeof documentFiles.$inferSelect): DocumentFile => {
  const parsed = documentFileSchema.safeParse({ ...row, createdAt: row.createdAt.toISOString() });
  if (!parsed.success) throw new Error('Stored document file is invalid');
  return parsed.data;
};

export const createDocumentRepository = (db: Db): DocumentRepository => ({
  listByTenant: async (tenantId, filter) =>
    databaseResult(async () => {
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
        .orderBy(desc(documents.documentDate));
      return rows.map(toDocument);
    }),
  findById: async (tenantId, documentId) =>
    databaseResult(async () => {
      const rows = await db
        .select()
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
        .limit(1);
      return rows[0] ? toDocument(rows[0]) : null;
    }),
  listFiles: async (tenantId, documentId) =>
    databaseResult(async () => {
      const rows = await db
        .select({ file: documentFiles })
        .from(documentFiles)
        .innerJoin(documents, eq(documentFiles.documentId, documents.id))
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
        .orderBy(documentFiles.createdAt);
      return rows.map((row) => toDocumentFile(row.file));
    }),
  create: async (input) =>
    databaseResult(async () => {
      const rows = await db.insert(documents).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('Document insert returned no row');
      return toDocument(row);
    }),
  update: async (tenantId, documentId, input) =>
    databaseResult(async () => {
      const rows = await db
        .update(documents)
        .set({ ...input, person: input.person ?? null, updatedAt: sql`now()` })
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
        .returning();
      return rows[0] ? toDocument(rows[0]) : null;
    }),
  delete: async (tenantId, documentId) =>
    databaseResult(async () => {
      const rows = await db
        .delete(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
        .returning({ id: documents.id });
      return rows.length > 0;
    }),
  createFile: async (tenantId, input) =>
    databaseResult(async () => {
      const owner = await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.tenantId, tenantId), eq(documents.id, input.documentId)))
        .limit(1);
      if (!owner[0]) return null;
      const rows = await db.insert(documentFiles).values(input).returning();
      return rows[0] ? toDocumentFile(rows[0]) : null;
    }),
  findFile: async (tenantId, documentId, fileId) =>
    databaseResult(async () => {
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
      return rows[0] ? toDocumentFile(rows[0].file) : null;
    }),
  deleteFile: async (tenantId, documentId, fileId) =>
    databaseResult(async () => {
      const owned = await db
        .select({ id: documentFiles.id })
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
      if (!owned[0]) return false;
      const rows = await db
        .delete(documentFiles)
        .where(eq(documentFiles.id, fileId))
        .returning({ id: documentFiles.id });
      return rows.length > 0;
    }),
});
