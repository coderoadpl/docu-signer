import {
  appError,
  completeSourceUpdateRequestSchema,
  createSourceUpdateRequestSchema,
  decideSourceUpdateRequestSchema,
  err,
  forbidden,
  notFound,
  ok,
  sourceUpdateRequestSchema,
  validation,
  type AppError,
  type CompleteSourceUpdateRequest,
  type CreateSourceUpdateRequest,
  type DecideSourceUpdateRequest,
  type Result,
  type SourceUpdateRequest,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentRepository,
  IdGenerator,
  SignatureRecordRepository,
  SourceUpdateRequestRepository,
  StoragePort,
} from '../ports.js';
import {
  attemptPdfSeal,
  recordPdfSeal,
  type PdfSealingDeps,
} from './pdf-sealing.js';

export interface SourceUpdateRequestDeps {
  documents: DocumentRepository;
  ids: IdGenerator;
  signatureRecords: SignatureRecordRepository;
  sourceUpdateRequests: SourceUpdateRequestRepository;
  storage: StoragePort;
  pdfSealing?: PdfSealingDeps;
}

const parseRequestId = (requestId: string): Result<string, AppError> => {
  const parsed = sourceUpdateRequestSchema.shape.id.safeParse(requestId);
  return parsed.success ? ok(parsed.data) : err(validation('Invalid source update request id'));
};

const parseDocumentId = (documentId: string): Result<string, AppError> => {
  const parsed = sourceUpdateRequestSchema.shape.documentId.safeParse(documentId);
  return parsed.success ? ok(parsed.data) : err(validation('Invalid document id'));
};

export const createSourceUpdateRequest = async (
  ctx: Ctx,
  documentId: string,
  input: CreateSourceUpdateRequest,
  deps: SourceUpdateRequestDeps,
): Promise<Result<SourceUpdateRequest, AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:manage');
  if (!scope.ok) return scope;
  const parsedDocumentId = parseDocumentId(documentId);
  if (!parsedDocumentId.ok) return parsedDocumentId;
  const parsed = createSourceUpdateRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid source update request', parsed.error.flatten()));
  }
  const document = await deps.documents.findById(scope.value, parsedDocumentId.value);
  if (!document) return err(notFound('Document not found'));
  const newSourceFile = await deps.documents.findFile(
    scope.value,
    parsedDocumentId.value,
    parsed.data.newSourceFileId,
  );
  if (!newSourceFile) return err(notFound('Replacement source file not found'));
  if (newSourceFile.role !== 'other') {
    return err(validation('Replacement source file must be staged as other'));
  }
  const records = await deps.signatureRecords.listByDocument(
    scope.value,
    parsedDocumentId.value,
    null,
    1000,
  );
  const files = await deps.documents.listFiles(scope.value, parsedDocumentId.value);
  const hasSignedDigital = files.some((file) => file.role === 'signed-digital');
  if (parsed.data.mode === 'transfer' && hasSignedDigital && records.length === 0) {
    return err(
      validation(
        'Signed documents without signature records must be signed again',
      ),
    );
  }
  if (
    parsed.data.mode === 'transfer' &&
    records.length > 0 &&
    newSourceFile.contentType !== 'application/pdf'
  ) {
    return err(validation('Signature transfer requires a PDF replacement source'));
  }
  const approverIds = parsed.data.mode === 'transfer'
    ? [...new Set(
        records
          .flatMap((record) =>
            record.payload.map((stamp) => stamp.contributedBy ?? record.signedBy),
          )
          .filter((contributorId) => contributorId !== ctx.identity.userId),
      )]
    : [];
  const created = await deps.sourceUpdateRequests.create({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    documentId: parsedDocumentId.value,
    requestedBy: ctx.identity.userId,
    newSourceFileId: parsed.data.newSourceFileId,
    mode: parsed.data.mode,
    approvalIds: approverIds.map((approverId) => ({
      id: deps.ids.nextId(),
      approverId,
    })),
  });
  return created
    ? ok(created)
    : err(appError('conflict', 'A source update is already pending for this document'));
};

export const getActiveSourceUpdateRequest = async (
  ctx: Ctx,
  documentId: string,
  deps: Pick<SourceUpdateRequestDeps, 'sourceUpdateRequests'>,
): Promise<Result<SourceUpdateRequest | null, AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:read');
  if (!scope.ok) return scope;
  const parsedDocumentId = parseDocumentId(documentId);
  if (!parsedDocumentId.ok) return parsedDocumentId;
  return ok(
    await deps.sourceUpdateRequests.findActiveByDocument(
      scope.value,
      parsedDocumentId.value,
    ),
  );
};

export const listPendingSourceUpdateRequests = async (
  ctx: Ctx,
  deps: Pick<SourceUpdateRequestDeps, 'sourceUpdateRequests'>,
): Promise<Result<SourceUpdateRequest[], AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:read');
  if (!scope.ok) return scope;
  return ok(
    await deps.sourceUpdateRequests.listPendingByApprover(
      scope.value,
      ctx.identity.userId,
    ),
  );
};

export const decideSourceUpdateRequest = async (
  ctx: Ctx,
  requestId: string,
  input: DecideSourceUpdateRequest,
  deps: Pick<SourceUpdateRequestDeps, 'sourceUpdateRequests'>,
): Promise<Result<SourceUpdateRequest, AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:manage');
  if (!scope.ok) return scope;
  const parsedRequestId = parseRequestId(requestId);
  if (!parsedRequestId.ok) return parsedRequestId;
  const parsed = decideSourceUpdateRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid source update decision', parsed.error.flatten()));
  }
  const request = await deps.sourceUpdateRequests.findById(
    scope.value,
    parsedRequestId.value,
  );
  if (!request) return err(notFound('Source update request not found'));
  if (request.status !== 'pending') {
    return err(appError('conflict', 'Source update request is no longer pending'));
  }
  const approval = request.approvals.find(
    (candidate) => candidate.approverId === ctx.identity.userId,
  );
  if (!approval) return err(forbidden('Only a requested signer can decide this source update'));
  if (approval.decision !== 'pending') {
    return err(appError('conflict', 'Source update decision was already recorded'));
  }
  const decided = await deps.sourceUpdateRequests.decide(
    scope.value,
    parsedRequestId.value,
    ctx.identity.userId,
    parsed.data.decision === 'accept' ? 'accepted' : 'rejected',
  );
  return decided
    ? ok(decided)
    : err(appError('conflict', 'Source update request is no longer pending'));
};

export const cancelSourceUpdateRequest = async (
  ctx: Ctx,
  requestId: string,
  deps: Pick<SourceUpdateRequestDeps, 'sourceUpdateRequests'>,
): Promise<Result<SourceUpdateRequest, AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:manage');
  if (!scope.ok) return scope;
  const parsedRequestId = parseRequestId(requestId);
  if (!parsedRequestId.ok) return parsedRequestId;
  const request = await deps.sourceUpdateRequests.findById(
    scope.value,
    parsedRequestId.value,
  );
  if (!request) return err(notFound('Source update request not found'));
  if (request.requestedBy !== ctx.identity.userId) {
    return err(forbidden('Only the requester can cancel this source update'));
  }
  const cancelled = await deps.sourceUpdateRequests.cancel(
    scope.value,
    parsedRequestId.value,
    ctx.identity.userId,
  );
  return cancelled
    ? ok(cancelled)
    : err(appError('conflict', 'Source update request is no longer pending'));
};

export const completeSourceUpdateRequest = async (
  ctx: Ctx,
  requestId: string,
  input: CompleteSourceUpdateRequest,
  deps: SourceUpdateRequestDeps,
): Promise<Result<SourceUpdateRequest, AppError>> => {
  const scope = authorizeTenant(ctx, 'source-update:manage');
  if (!scope.ok) return scope;
  const parsedRequestId = parseRequestId(requestId);
  if (!parsedRequestId.ok) return parsedRequestId;
  const parsed = completeSourceUpdateRequestSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid source update completion', parsed.error.flatten()));
  }
  const request = await deps.sourceUpdateRequests.findById(
    scope.value,
    parsedRequestId.value,
  );
  if (!request) return err(notFound('Source update request not found'));
  if (request.status !== 'pending') {
    return err(appError('conflict', 'Source update request is no longer pending'));
  }
  const actorCanComplete =
    request.requestedBy === ctx.identity.userId ||
    request.approvals.some(
      (approval) =>
        approval.approverId === ctx.identity.userId &&
        approval.decision === 'accepted',
    );
  if (!actorCanComplete) {
    return err(forbidden('Only the requester or an accepting signer can complete this source update'));
  }
  if (request.approvals.some((approval) => approval.decision !== 'accepted')) {
    return err(appError('conflict', 'All requested signers must accept before completion'));
  }
  const files = await deps.documents.listFiles(scope.value, request.documentId);
  const newSourceFile = await deps.documents.findFile(
    scope.value,
    request.documentId,
    request.newSourceFileId,
  );
  if (!newSourceFile || newSourceFile.role !== 'other') {
    return err(notFound('Replacement source file not found'));
  }
  const records = await deps.signatureRecords.listByDocument(
    scope.value,
    request.documentId,
    null,
    1000,
  );
  if (request.mode === 'delete-signed' && parsed.data.signedFileId) {
    return err(validation('Delete-signed completion cannot include a signed file'));
  }
  if (request.mode === 'transfer' && records.length > 0 && !parsed.data.signedFileId) {
    return err(validation('Transferred signatures require a regenerated signed file'));
  }
  const signedFile = parsed.data.signedFileId
    ? await deps.documents.findFile(
        scope.value,
        request.documentId,
        parsed.data.signedFileId,
      )
    : undefined;
  if (parsed.data.signedFileId && (!signedFile || signedFile.role !== 'other')) {
    return err(notFound('Regenerated signed file not found'));
  }
  if (signedFile?.id === newSourceFile.id) {
    return err(validation('Source and regenerated signed file must differ'));
  }
  const priorSourceFiles = files.filter((file) => file.role === 'source');
  const priorSignedFiles = files.filter((file) => file.role === 'signed-digital');
  const completed = await deps.sourceUpdateRequests.complete({
    tenantId: scope.value,
    requestId: request.id,
    completedBy: ctx.identity.userId,
    signedFileId: signedFile?.id ?? null,
  });
  if (!completed) {
    return err(appError('conflict', 'Source update request could not be completed'));
  }
  if (signedFile && deps.pdfSealing) {
    try {
      const document = await deps.documents.findById(scope.value, request.documentId);
      const bytes = await deps.storage.get(signedFile.storageKey);
      if (document && bytes.ok && bytes.value) {
        const sealed = await attemptPdfSeal(
          { tenantId: scope.value, document, bytes: bytes.value },
          deps.pdfSealing,
        );
        if (sealed) {
          const replaced = await deps.storage.put(
            signedFile.storageKey,
            sealed.bytes,
            signedFile.contentType,
          );
          if (replaced.ok) {
            await deps.documents.updateFileSize?.(
              scope.value,
              request.documentId,
              signedFile.id,
              sealed.bytes.byteLength,
            );
            await recordPdfSeal(
              {
                tenantId: scope.value,
                documentId: request.documentId,
                fileId: signedFile.id,
                signedBy: ctx.identity.userId,
                metadata: sealed.metadata,
              },
              deps.pdfSealing,
            );
          } else {
            deps.pdfSealing.warnings.warn('Replayed PDF seal could not replace the promoted artifact', {
              tenantId: scope.value,
              documentId: request.documentId,
              fileId: signedFile.id,
              error: replaced.error.message,
            });
          }
        }
      }
    } catch (cause) {
      // WHY: source replay is complete before sealing, so seal enrichment cannot roll it back or block it.
      deps.pdfSealing.warnings.warn('Replayed PDF sealing failed after source update completion', {
        tenantId: scope.value,
        documentId: request.documentId,
        fileId: signedFile.id,
        cause: String(cause),
      });
    }
  }
  for (const file of [...priorSourceFiles, ...priorSignedFiles]) {
    await deps.storage.delete(file.storageKey);
  }
  return ok(completed);
};
