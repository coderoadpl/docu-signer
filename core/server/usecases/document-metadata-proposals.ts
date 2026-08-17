import {
  decodeOpaqueCursor,
  documentMetadataProposalCursorSchema,
  documentMetadataProposalSchema,
  encodeOpaqueCursor,
  err,
  notFound,
  ok,
  paginationQuerySchema,
  updateDocumentSchema,
  validation,
  type AppError,
  type Document,
  type DocumentMetadataChanges,
  type DocumentMetadataProposalListItem,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentMetadataProposalRepository,
  DocumentRepository,
  DocumentTypeRepository,
} from '../ports.js';

export interface DocumentMetadataProposalDeps {
  documentMetadataProposals: DocumentMetadataProposalRepository;
  documents: DocumentRepository;
  documentTypes: DocumentTypeRepository;
}

export interface AppliedMetadataProposals {
  documentIds: string[];
  applied: number;
}

const mergedMetadata = (
  document: Awaited<ReturnType<DocumentRepository['findById']>>,
  changes: DocumentMetadataChanges,
) =>
  document
    ? {
        title: changes.title ?? document.title,
        docType: changes.docType ?? document.docType,
        documentDate: changes.documentDate ?? document.documentDate,
        periodStart:
          changes.periodStart === undefined ? document.periodStart : changes.periodStart,
        periodEnd: changes.periodEnd === undefined ? document.periodEnd : changes.periodEnd,
        person: changes.person === undefined ? document.person : changes.person,
        tags: changes.tags ?? document.tags,
      }
    : null;

export const listDocumentMetadataProposals = async (
  ctx: Ctx,
  documentId: string,
  input: unknown,
  deps: DocumentMetadataProposalDeps,
): Promise<
  Result<
    { items: DocumentMetadataProposalListItem[]; nextCursor: string | null },
    AppError
  >
> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const parsedDocumentId = documentMetadataProposalSchema.shape.documentId.safeParse(documentId);
  if (!parsedDocumentId.success) return err(validation('Invalid document id'));
  const parsedInput = paginationQuerySchema.safeParse(input);
  if (!parsedInput.success) {
    return err(validation('Invalid metadata proposal pagination', parsedInput.error.flatten()));
  }
  const cursor = parsedInput.data.cursor
    ? documentMetadataProposalCursorSchema.safeParse(
        decodeOpaqueCursor(parsedInput.data.cursor),
      )
    : null;
  if (cursor && !cursor.success) return err(validation('Invalid metadata proposal cursor'));
  if (!(await deps.documents.findAnyById(scope.value, parsedDocumentId.data))) {
    return err(notFound('Document not found'));
  }
  const rows = await deps.documentMetadataProposals.listByDocument(
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

export const approveDocumentMetadataProposal = async (
  ctx: Ctx,
  proposalId: string,
  deps: DocumentMetadataProposalDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const parsedProposalId = documentMetadataProposalSchema.shape.id.safeParse(proposalId);
  if (!parsedProposalId.success) return err(validation('Invalid metadata proposal id'));
  const proposal = await deps.documentMetadataProposals.findById(
    scope.value,
    parsedProposalId.data,
  );
  if (!proposal) return err(notFound('Document metadata proposal not found'));
  const document = await deps.documents.findById(scope.value, proposal.documentId);
  if (!document) return err(notFound('Document not found'));
  const merged = mergedMetadata(document, proposal.changes);
  const parsed = updateDocumentSchema.safeParse(merged);
  if (!parsed.success) {
    return err(validation('Invalid proposed document metadata', parsed.error.flatten()));
  }
  if (!(await deps.documentTypes.findBySlug(scope.value, parsed.data.docType))) {
    return err(validation('Unknown document type'));
  }
  const updated = await deps.documentMetadataProposals.apply(
    scope.value,
    parsedProposalId.data,
    proposal.changes,
  );
  return updated ? ok(updated) : err(notFound('Document metadata proposal not found'));
};

export const applyPendingMetadataProposals = async (
  tenantId: string,
  documentIds: readonly string[],
  deps: DocumentMetadataProposalDeps,
): Promise<Result<AppliedMetadataProposals, AppError>> => {
  const proposals = await deps.documentMetadataProposals.listPendingByDocuments(
    tenantId,
    [...documentIds],
  );
  const plannedProposalIds: string[] = [];
  const changedDocumentIds: string[] = [];
  for (const documentId of documentIds) {
    const documentProposals = proposals.filter((proposal) => proposal.documentId === documentId);
    if (documentProposals.length === 0) continue;
    const document = await deps.documents.findById(tenantId, documentId);
    if (!document) return err(notFound('Document not found'));
    let current = document;
    for (const proposal of documentProposals) {
      const parsed = updateDocumentSchema.safeParse(mergedMetadata(current, proposal.changes));
      if (!parsed.success) {
        return err(validation('Invalid proposed document metadata', parsed.error.flatten()));
      }
      if (!(await deps.documentTypes.findBySlug(tenantId, parsed.data.docType))) {
        return err(validation('Unknown document type'));
      }
      current = {
        ...current,
        title: parsed.data.title,
        docType: parsed.data.docType,
        documentDate: parsed.data.documentDate,
        periodStart: parsed.data.periodStart ?? null,
        periodEnd: parsed.data.periodEnd ?? null,
        person: parsed.data.person ?? null,
        tags: parsed.data.tags,
      };
      plannedProposalIds.push(proposal.id);
    }
    changedDocumentIds.push(documentId);
  }
  for (const proposalId of plannedProposalIds) {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal) return err(notFound('Document metadata proposal not found'));
    if (!(await deps.documentMetadataProposals.apply(tenantId, proposalId, proposal.changes))) {
      return err(notFound('Document metadata proposal not found'));
    }
  }
  return ok({ documentIds: changedDocumentIds, applied: plannedProposalIds.length });
};

export const rejectDocumentMetadataProposal = async (
  ctx: Ctx,
  proposalId: string,
  deps: Pick<DocumentMetadataProposalDeps, 'documentMetadataProposals'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const parsedProposalId = documentMetadataProposalSchema.shape.id.safeParse(proposalId);
  if (!parsedProposalId.success) return err(validation('Invalid metadata proposal id'));
  return (await deps.documentMetadataProposals.reject(scope.value, parsedProposalId.data))
    ? ok(undefined)
    : err(notFound('Document metadata proposal not found'));
};
