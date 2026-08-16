import { and, asc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import {
  documentLinkSchema,
  documentSchema,
  linkedDocumentSchema,
  type DocumentLink,
  type LinkedDocument,
} from '#core/domain/index.js';
import type { DocumentLinkRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documentLinks, documents } from './schema.js';

const toDocumentLink = (row: typeof documentLinks.$inferSelect): DocumentLink =>
  documentLinkSchema.parse(row);

const linkedDocuments = alias(documents, 'linked_documents');

const toLinkedDocument = (row: {
  link: typeof documentLinks.$inferSelect;
  document: typeof documents.$inferSelect;
}): LinkedDocument =>
  linkedDocumentSchema.parse({
    linkId: row.link.id,
    label: row.link.label,
    draft: row.link.draft,
    document: documentSchema.parse({
      ...row.document,
      createdAt: row.document.createdAt.toISOString(),
      updatedAt: row.document.updatedAt.toISOString(),
      deletedAt: row.document.deletedAt?.toISOString() ?? null,
    }),
  });

const pairCondition = (
  tenantId: string,
  firstDocumentId: string,
  secondDocumentId: string,
) =>
  and(
    eq(documentLinks.tenantId, tenantId),
    or(
      and(
        eq(documentLinks.fromDocumentId, firstDocumentId),
        eq(documentLinks.toDocumentId, secondDocumentId),
      ),
      and(
        eq(documentLinks.fromDocumentId, secondDocumentId),
        eq(documentLinks.toDocumentId, firstDocumentId),
      ),
    ),
  );

export const createDocumentLinkRepository = (db: Db): DocumentLinkRepository => ({
  create: async (tenantId, input) => {
    const rows = await db
      .insert(documentLinks)
      .values({ tenantId, ...input })
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toDocumentLink(rows[0]) : null;
  },
  findBetween: async (tenantId, firstDocumentId, secondDocumentId) => {
    const rows = await db
      .select()
      .from(documentLinks)
      .where(pairCondition(tenantId, firstDocumentId, secondDocumentId))
      .limit(1);
    return rows[0] ? toDocumentLink(rows[0]) : null;
  },
  listForDocument: async (tenantId, documentId) => {
    const rows = await db
      .select({ link: documentLinks, document: linkedDocuments })
      .from(documentLinks)
      .innerJoin(
        linkedDocuments,
        and(
          eq(linkedDocuments.tenantId, tenantId),
          or(
            and(
              eq(documentLinks.fromDocumentId, documentId),
              eq(linkedDocuments.id, documentLinks.toDocumentId),
            ),
            and(
              eq(documentLinks.toDocumentId, documentId),
              eq(linkedDocuments.id, documentLinks.fromDocumentId),
            ),
          ),
        ),
      )
      .where(
        and(
          eq(documentLinks.tenantId, tenantId),
          or(
            eq(documentLinks.fromDocumentId, documentId),
            eq(documentLinks.toDocumentId, documentId),
          ),
        ),
      )
      .orderBy(asc(linkedDocuments.title), asc(linkedDocuments.id));
    return rows.map(toLinkedDocument);
  },
  approve: async (tenantId, linkId) => {
    const rows = await db
      .update(documentLinks)
      .set({ draft: false })
      .where(and(eq(documentLinks.tenantId, tenantId), eq(documentLinks.id, linkId)))
      .returning();
    return rows[0] ? toDocumentLink(rows[0]) : null;
  },
  deleteBetween: async (tenantId, firstDocumentId, secondDocumentId) => {
    const rows = await db
      .delete(documentLinks)
      .where(pairCondition(tenantId, firstDocumentId, secondDocumentId))
      .returning({ id: documentLinks.id });
    return rows.length > 0;
  },
});
