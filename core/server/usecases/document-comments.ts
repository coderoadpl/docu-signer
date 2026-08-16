import {
  createDocumentCommentSchema,
  decodeOpaqueCursor,
  documentCommentCursorSchema,
  documentCommentSchema,
  encodeOpaqueCursor,
  err,
  forbidden,
  notFound,
  ok,
  paginationQuerySchema,
  validation,
  type AppError,
  type CreateDocumentComment,
  type DocumentCommentListItem,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentCommentRepository,
  DocumentRepository,
  IdGenerator,
} from '../ports.js';

export interface DocumentCommentDeps {
  documentComments: DocumentCommentRepository;
  documents: DocumentRepository;
  ids: IdGenerator;
}

const writeTokenRequiresDraft = (ctx: Ctx): boolean =>
  ctx.identity.apiToken !== null &&
  !ctx.identity.apiToken.scopes.includes('write');

export const addDocumentComment = async (
  ctx: Ctx,
  documentId: string,
  input: CreateDocumentComment,
  deps: DocumentCommentDeps,
): Promise<Result<DocumentCommentListItem, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsedDocumentId = documentCommentSchema.shape.documentId.safeParse(documentId);
  if (!parsedDocumentId.success) return err(validation('Invalid document id'));
  const parsed = createDocumentCommentSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid document comment', parsed.error.flatten()));
  }
  const document = await deps.documents.findById(scope.value, parsedDocumentId.data);
  if (!document) return err(notFound('Document not found'));
  if (writeTokenRequiresDraft(ctx) && !document.draft) {
    return err(forbidden('write:draft tokens can only modify draft documents'));
  }
  return ok(
    await deps.documentComments.create({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      documentId: parsedDocumentId.data,
      authorAccountId: ctx.identity.userId,
      body: parsed.data.body,
    }),
  );
};

export const deleteDocumentComment = async (
  ctx: Ctx,
  documentId: string,
  commentId: string,
  deps: Pick<DocumentCommentDeps, 'documentComments' | 'documents'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  if (ctx.identity.apiToken !== null) {
    return err(forbidden('API tokens cannot delete document comments'));
  }
  const parsedDocumentId = documentCommentSchema.shape.documentId.safeParse(documentId);
  const parsedCommentId = documentCommentSchema.shape.id.safeParse(commentId);
  if (!parsedDocumentId.success || !parsedCommentId.success) {
    return err(validation('Invalid document comment id'));
  }
  if (!(await deps.documents.findById(scope.value, parsedDocumentId.data))) {
    return err(notFound('Document not found'));
  }
  const comment = await deps.documentComments.findById(
    scope.value,
    parsedDocumentId.data,
    parsedCommentId.data,
  );
  if (!comment) return err(notFound('Document comment not found'));
  if (comment.authorAccountId !== ctx.identity.userId) {
    return err(forbidden('Only the comment author can delete it'));
  }
  return (await deps.documentComments.delete(
    scope.value,
    parsedDocumentId.data,
    parsedCommentId.data,
  ))
    ? ok(undefined)
    : err(notFound('Document comment not found'));
};

export const listDocumentComments = async (
  ctx: Ctx,
  documentId: string,
  input: unknown,
  deps: Pick<DocumentCommentDeps, 'documentComments' | 'documents'>,
): Promise<
  Result<{ items: DocumentCommentListItem[]; nextCursor: string | null }, AppError>
> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const parsedDocumentId = documentCommentSchema.shape.documentId.safeParse(documentId);
  if (!parsedDocumentId.success) return err(validation('Invalid document id'));
  const parsedInput = paginationQuerySchema.safeParse(input);
  if (!parsedInput.success) {
    return err(validation('Invalid document comment pagination', parsedInput.error.flatten()));
  }
  const cursor = parsedInput.data.cursor
    ? documentCommentCursorSchema.safeParse(decodeOpaqueCursor(parsedInput.data.cursor))
    : null;
  if (cursor && !cursor.success) return err(validation('Invalid document comment cursor'));
  if (!(await deps.documents.findAnyById(scope.value, parsedDocumentId.data))) {
    return err(notFound('Document not found'));
  }
  const rows = await deps.documentComments.listByDocument(
    scope.value,
    parsedDocumentId.data,
    cursor?.data ?? null,
    parsedInput.data.limit + 1,
  );
  const items = rows.slice(0, parsedInput.data.limit);
  const last = rows.length > parsedInput.data.limit ? items.at(-1) : undefined;
  return ok({
    items,
    nextCursor: last
      ? encodeOpaqueCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  });
};
