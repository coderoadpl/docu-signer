import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';

import {
  documentMetadataProposalListItemSchema,
  documentMetadataProposalSchema,
  documentSchema,
  type DocumentMetadataProposal,
  type DocumentMetadataProposalListItem,
} from '#core/domain/index.js';
import type { DocumentMetadataProposalRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documentMetadataProposals, documents, user } from './schema.js';

const toProposal = (
  row: typeof documentMetadataProposals.$inferSelect,
): DocumentMetadataProposal =>
  documentMetadataProposalSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });

const toListItem = (row: {
  proposal: typeof documentMetadataProposals.$inferSelect;
  creator: { accountId: string; name: string };
}): DocumentMetadataProposalListItem =>
  documentMetadataProposalListItemSchema.parse({
    ...toProposal(row.proposal),
    creator: row.creator,
  });

const findListItemById = async (
  db: Db,
  tenantId: string,
  proposalId: string,
): Promise<DocumentMetadataProposalListItem | null> => {
  const rows = await db
    .select({
      proposal: documentMetadataProposals,
      creator: { accountId: user.id, name: user.name },
    })
    .from(documentMetadataProposals)
    .innerJoin(user, eq(user.id, documentMetadataProposals.creatorAccountId))
    .where(
      and(
        eq(documentMetadataProposals.tenantId, tenantId),
        eq(documentMetadataProposals.id, proposalId),
      ),
    )
    .limit(1);
  return rows[0] ? toListItem(rows[0]) : null;
};

export const createDocumentMetadataProposalRepository = (
  db: Db,
): DocumentMetadataProposalRepository => ({
  listPendingByDocuments: async (tenantId, documentIds) => {
    if (documentIds.length === 0) return [];
    const rows = await db
      .select()
      .from(documentMetadataProposals)
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          inArray(documentMetadataProposals.documentId, documentIds),
        ),
      )
      .orderBy(
        asc(documentMetadataProposals.documentId),
        asc(documentMetadataProposals.createdAt),
        asc(documentMetadataProposals.id),
      );
    return rows.map(toProposal);
  },
  listByDocument: async (tenantId, documentId, cursor, limit) => {
    const cursorCondition = cursor
      ? or(
          gt(documentMetadataProposals.createdAt, new Date(cursor.createdAt)),
          and(
            eq(documentMetadataProposals.createdAt, new Date(cursor.createdAt)),
            gt(documentMetadataProposals.id, cursor.id),
          ),
        )
      : undefined;
    const rows = await db
      .select({
        proposal: documentMetadataProposals,
        creator: { accountId: user.id, name: user.name },
      })
      .from(documentMetadataProposals)
      .innerJoin(user, eq(user.id, documentMetadataProposals.creatorAccountId))
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          eq(documentMetadataProposals.documentId, documentId),
          cursorCondition,
        ),
      )
      .orderBy(
        asc(documentMetadataProposals.createdAt),
        asc(documentMetadataProposals.id),
      )
      .limit(limit);
    return rows.map(toListItem);
  },
  create: async (input) => {
    await db.insert(documentMetadataProposals).values(input);
    const created = await findListItemById(db, input.tenantId, input.id);
    if (!created) throw new Error('Created document metadata proposal could not be read');
    return created;
  },
  findById: async (tenantId, proposalId) => {
    const rows = await db
      .select()
      .from(documentMetadataProposals)
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          eq(documentMetadataProposals.id, proposalId),
        ),
      )
      .limit(1);
    return rows[0] ? toProposal(rows[0]) : null;
  },
  apply: async (tenantId, proposalId, changes) => {
    const proposals = await db
      .select({ documentId: documentMetadataProposals.documentId })
      .from(documentMetadataProposals)
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          eq(documentMetadataProposals.id, proposalId),
        ),
      )
      .limit(1);
    const proposal = proposals[0];
    if (!proposal) return null;
    const rows = await db
      .update(documents)
      .set({ ...changes, updatedAt: sql`now()` })
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.id, proposal.documentId),
        ),
      )
      .returning();
    const updated = rows[0];
    if (!updated) return null;
    await db
      .delete(documentMetadataProposals)
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          eq(documentMetadataProposals.id, proposalId),
        ),
      );
    return documentSchema.parse({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      deletedAt: updated.deletedAt?.toISOString() ?? null,
    });
  },
  reject: async (tenantId, proposalId) => {
    const rows = await db
      .delete(documentMetadataProposals)
      .where(
        and(
          eq(documentMetadataProposals.tenantId, tenantId),
          eq(documentMetadataProposals.id, proposalId),
        ),
      )
      .returning({ id: documentMetadataProposals.id });
    return rows.length > 0;
  },
});
