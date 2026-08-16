import {
  appError,
  documentLinkSchema,
  err,
  linkDocumentsInputSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type DocumentLink,
  type LinkDocumentsInput,
  type LinkedDocument,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DocumentLinkRepository, DocumentRepository, IdGenerator } from '../ports.js';

export interface DocumentLinkDeps {
  documentLinks: DocumentLinkRepository;
  documents: DocumentRepository;
  ids: IdGenerator;
}

const annotationIsDraft = (ctx: Ctx): boolean =>
  ctx.identity.apiToken !== null &&
  !ctx.identity.apiToken.scopes.includes('write');

const orderedPair = (firstDocumentId: string, secondDocumentId: string) =>
  firstDocumentId < secondDocumentId
    ? { fromDocumentId: firstDocumentId, toDocumentId: secondDocumentId }
    : { fromDocumentId: secondDocumentId, toDocumentId: firstDocumentId };

const validatePair = (
  documentId: string,
  input: LinkDocumentsInput,
): Result<{ otherDocumentId: string; label: string | null }, AppError> => {
  const parsed = linkDocumentsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid document link', parsed.error.flatten()));
  }
  if (documentId === parsed.data.otherDocumentId) {
    return err(validation('A document cannot be linked to itself'));
  }
  return ok({
    otherDocumentId: parsed.data.otherDocumentId,
    label: parsed.data.label ?? null,
  });
};

export const linkDocuments = async (
  ctx: Ctx,
  documentId: string,
  input: LinkDocumentsInput,
  deps: DocumentLinkDeps,
): Promise<Result<LinkedDocument, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const pairInput = validatePair(documentId, input);
  if (!pairInput.ok) return pairInput;
  const [document, otherDocument] = await Promise.all([
    deps.documents.findAnyById(scope.value, documentId),
    deps.documents.findAnyById(scope.value, pairInput.value.otherDocumentId),
  ]);
  if (!document || !otherDocument) return err(notFound('Document not found'));
  const pair = orderedPair(documentId, pairInput.value.otherDocumentId);
  const existing = await deps.documentLinks.findBetween(
    scope.value,
    pair.fromDocumentId,
    pair.toDocumentId,
  );
  if (existing) return err(appError('conflict', 'Documents are already linked'));
  const created = await deps.documentLinks.create(scope.value, {
    id: deps.ids.nextId(),
    ...pair,
    label: pairInput.value.label,
    draft: annotationIsDraft(ctx),
  });
  return created
    ? ok({
        linkId: created.id,
        label: created.label,
        draft: created.draft,
        document: otherDocument,
      })
    : err(appError('conflict', 'Documents are already linked'));
};

export const approveDocumentLink = async (
  ctx: Ctx,
  linkId: string,
  deps: Pick<DocumentLinkDeps, 'documentLinks'>,
): Promise<Result<DocumentLink, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const parsedLinkId = documentLinkSchema.shape.id.safeParse(linkId);
  if (!parsedLinkId.success) return err(validation('Invalid document link id'));
  const approved = await deps.documentLinks.approve(scope.value, parsedLinkId.data);
  return approved ? ok(approved) : err(notFound('Document link not found'));
};

export const unlinkDocuments = async (
  ctx: Ctx,
  documentId: string,
  otherDocumentId: string,
  deps: DocumentLinkDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const pairInput = validatePair(documentId, { otherDocumentId });
  if (!pairInput.ok) return pairInput;
  const [document, otherDocument] = await Promise.all([
    deps.documents.findAnyById(scope.value, documentId),
    deps.documents.findAnyById(scope.value, pairInput.value.otherDocumentId),
  ]);
  if (!document || !otherDocument) return err(notFound('Document not found'));
  const pair = orderedPair(documentId, pairInput.value.otherDocumentId);
  const deleted = await deps.documentLinks.deleteBetween(
    scope.value,
    pair.fromDocumentId,
    pair.toDocumentId,
  );
  return deleted ? ok(undefined) : err(notFound('Document link not found'));
};

export const listDocumentLinks = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentLinkDeps,
): Promise<Result<LinkedDocument[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const document = await deps.documents.findAnyById(scope.value, documentId);
  if (!document) return err(notFound('Document not found'));
  return ok(await deps.documentLinks.listForDocument(scope.value, documentId));
};
