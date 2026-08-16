import { and, asc, eq, gt, or } from 'drizzle-orm';

import {
  documentCommentListItemSchema,
  documentCommentSchema,
  type DocumentComment,
  type DocumentCommentListItem,
} from '#core/domain/index.js';
import type { DocumentCommentRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { documentComments, user } from './schema.js';

const toDocumentComment = (
  row: typeof documentComments.$inferSelect,
): DocumentComment =>
  documentCommentSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });

const toDocumentCommentListItem = (row: {
  comment: typeof documentComments.$inferSelect;
  author: { accountId: string; name: string };
}): DocumentCommentListItem =>
  documentCommentListItemSchema.parse({
    ...toDocumentComment(row.comment),
    author: row.author,
  });

const findListItemById = async (
  db: Db,
  tenantId: string,
  documentId: string,
  commentId: string,
): Promise<DocumentCommentListItem | null> => {
  const rows = await db
    .select({
      comment: documentComments,
      author: { accountId: user.id, name: user.name },
    })
    .from(documentComments)
    .innerJoin(user, eq(user.id, documentComments.authorAccountId))
    .where(
      and(
        eq(documentComments.tenantId, tenantId),
        eq(documentComments.documentId, documentId),
        eq(documentComments.id, commentId),
      ),
    )
    .limit(1);
  return rows[0] ? toDocumentCommentListItem(rows[0]) : null;
};

export const createDocumentCommentRepository = (
  db: Db,
): DocumentCommentRepository => ({
  listByDocument: async (tenantId, documentId, cursor, limit) => {
    const cursorCondition = cursor
      ? or(
          gt(documentComments.createdAt, new Date(cursor.createdAt)),
          and(
            eq(documentComments.createdAt, new Date(cursor.createdAt)),
            gt(documentComments.id, cursor.id),
          ),
        )
      : undefined;
    const rows = await db
      .select({
        comment: documentComments,
        author: { accountId: user.id, name: user.name },
      })
      .from(documentComments)
      .innerJoin(user, eq(user.id, documentComments.authorAccountId))
      .where(
        and(
          eq(documentComments.tenantId, tenantId),
          eq(documentComments.documentId, documentId),
          cursorCondition,
        ),
      )
      .orderBy(asc(documentComments.createdAt), asc(documentComments.id))
      .limit(limit);
    return rows.map(toDocumentCommentListItem);
  },
  create: async (input) => {
    await db.insert(documentComments).values(input);
    const created = await findListItemById(
      db,
      input.tenantId,
      input.documentId,
      input.id,
    );
    if (!created) throw new Error('Created document comment could not be read');
    return created;
  },
  approve: async (tenantId, commentId) => {
    const rows = await db
      .update(documentComments)
      .set({ draft: false })
      .where(
        and(
          eq(documentComments.tenantId, tenantId),
          eq(documentComments.id, commentId),
        ),
      )
      .returning({ documentId: documentComments.documentId });
    const approved = rows[0];
    return approved
      ? findListItemById(db, tenantId, approved.documentId, commentId)
      : null;
  },
  findById: async (tenantId, documentId, commentId) => {
    const rows = await db
      .select()
      .from(documentComments)
      .where(
        and(
          eq(documentComments.tenantId, tenantId),
          eq(documentComments.documentId, documentId),
          eq(documentComments.id, commentId),
        ),
      )
      .limit(1);
    return rows[0] ? toDocumentComment(rows[0]) : null;
  },
  delete: async (tenantId, documentId, commentId) => {
    const rows = await db
      .delete(documentComments)
      .where(
        and(
          eq(documentComments.tenantId, tenantId),
          eq(documentComments.documentId, documentId),
          eq(documentComments.id, commentId),
        ),
      )
      .returning({ id: documentComments.id });
    return rows.length > 0;
  },
});
