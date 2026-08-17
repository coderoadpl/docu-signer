import { and, asc, eq } from 'drizzle-orm';

import {
  documentTypeDefinitionSchema,
  type DocumentType,
} from '#core/domain/index.js';
import type { DocumentTypeRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documents, documentTypes } from './schema.js';

const toDocumentType = (row: typeof documentTypes.$inferSelect): DocumentType =>
  documentTypeDefinitionSchema.parse(row);

export const createDocumentTypeRepository = (db: Db): DocumentTypeRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(documentTypes)
      .where(eq(documentTypes.tenantId, tenantId))
      .orderBy(asc(documentTypes.position), asc(documentTypes.slug));
    return rows.map(toDocumentType);
  },
  findBySlug: async (tenantId, slug) => {
    const rows = await db
      .select()
      .from(documentTypes)
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.slug, slug)))
      .limit(1);
    return rows[0] ? toDocumentType(rows[0]) : null;
  },
  create: async (input) => {
    const rows = await db
      .insert(documentTypes)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toDocumentType(rows[0]) : null;
  },
  rename: async (tenantId, slug, label) => {
    const rows = await db
      .update(documentTypes)
      .set({ label, updatedAt: new Date() })
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.slug, slug)))
      .returning();
    return rows[0] ? toDocumentType(rows[0]) : null;
  },
  setHidden: async (tenantId, slug, hidden) => {
    const rows = await db
      .update(documentTypes)
      .set({ hidden, updatedAt: new Date() })
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.slug, slug)))
      .returning();
    return rows[0] ? toDocumentType(rows[0]) : null;
  },
  delete: async (tenantId, slug) => {
    const rows = await db
      .delete(documentTypes)
      .where(and(eq(documentTypes.tenantId, tenantId), eq(documentTypes.slug, slug)))
      .returning({ slug: documentTypes.slug });
    return rows.length > 0;
  },
  isUsedByAnyDocument: async (tenantId, slug) => {
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.docType, slug)))
      .limit(1);
    return rows.length > 0;
  },
});
