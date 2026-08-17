import {
  bulkApprovePendingDraftsSchema,
  err,
  ok,
  validation,
  type AppError,
  type BulkApprovePendingDrafts,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DocumentCommentRepository, DocumentLinkRepository } from '../ports.js';
import { approveDocumentComment } from './document-comments.js';
import { approveDocumentLink } from './document-links.js';
import {
  applyPendingMetadataProposals,
  type DocumentMetadataProposalDeps,
} from './document-metadata-proposals.js';

export interface BulkApprovePendingDraftsDeps extends DocumentMetadataProposalDeps {
  documentComments: DocumentCommentRepository;
  documentLinks: DocumentLinkRepository;
}

export interface BulkApprovePendingDraftsResult {
  approved: number;
  skipped: number;
  metadataProposals: number;
  comments: number;
  links: number;
}

export const bulkApprovePendingDrafts = async (
  ctx: Ctx,
  input: BulkApprovePendingDrafts,
  deps: BulkApprovePendingDraftsDeps,
): Promise<Result<BulkApprovePendingDraftsResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const parsedInput = bulkApprovePendingDraftsSchema.safeParse(input);
  if (!parsedInput.success) {
    return err(validation('Invalid bulk pending draft approval', parsedInput.error.flatten()));
  }
  const { documentIds } = parsedInput.data;
  const proposals = await applyPendingMetadataProposals(scope.value, documentIds, deps);
  if (!proposals.ok) return proposals;
  const [comments, links] = await Promise.all([
    deps.documentComments.listPendingByDocuments(scope.value, documentIds),
    deps.documentLinks.listPendingByDocuments(scope.value, documentIds),
  ]);
  const changedDocumentIds = new Set(proposals.value.documentIds);
  for (const comment of comments) {
    const approved = await approveDocumentComment(ctx, comment.id, deps);
    if (!approved.ok) return approved;
    changedDocumentIds.add(comment.documentId);
  }
  for (const link of links) {
    const approved = await approveDocumentLink(ctx, link.id, deps);
    if (!approved.ok) return approved;
    for (const linkedId of [link.fromDocumentId, link.toDocumentId]) {
      if (documentIds.includes(linkedId)) changedDocumentIds.add(linkedId);
    }
  }
  return ok({
    approved: changedDocumentIds.size,
    skipped: documentIds.length - changedDocumentIds.size,
    metadataProposals: proposals.value.applied,
    comments: comments.length,
    links: links.length,
  });
};
