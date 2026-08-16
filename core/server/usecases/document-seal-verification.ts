import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type PdfSealVerification,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentRepository,
  PdfSealVerificationPort,
  StoragePort,
} from '../ports.js';

export interface DocumentSealVerificationDeps {
  documents: DocumentRepository;
  pdfSealVerification: PdfSealVerificationPort;
  storage: StoragePort;
}

export const getDocumentFileSealVerification = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  deps: DocumentSealVerificationDeps,
): Promise<Result<PdfSealVerification, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  if (
    file.role !== 'signed-digital' ||
    file.sealed !== true ||
    file.contentType.trim().toLowerCase() !== 'application/pdf'
  ) {
    return err(validation('Document file is not a sealed signed-digital PDF'));
  }
  const bytes = await deps.storage.get(file.storageKey);
  if (!bytes.ok) return bytes;
  if (!bytes.value) return err(notFound('Document file content not found'));
  return ok(deps.pdfSealVerification.verify(bytes.value));
};
