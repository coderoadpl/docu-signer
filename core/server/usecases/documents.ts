import {
  createDocumentSchema,
  documentListFilterSchema,
  documentMetadataChangesSchema,
  err,
  exportTooLarge,
  exportDocumentsSchema,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
  forbidden,
  MAX_DOCUMENT_EXPORT_FILES,
  MAX_DOCUMENT_EXPORT_BYTES,
  moveDocumentFileSchema,
  notFound,
  ok,
  updateDocumentSchema,
  validation,
  type AppError,
  type CreateDocument,
  type Document,
  type DocumentDetail,
  type DocumentFile,
  type DocumentListFilter,
  type DocumentListItem,
  type DocumentMetadataChanges,
  type DocumentMetadataProposalListItem,
  type DocumentWithFiles,
  type ExportDocuments,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type MoveDocumentFile,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentRepository,
  DocumentMetadataProposalRepository,
  DocumentTypeRepository,
  IdGenerator,
  StoragePort,
  UploadTarget,
} from '../ports.js';
import {
  attemptPdfSeal,
  preparePdfSeal,
  recordPdfSeal,
  type PdfSealingDeps,
} from './pdf-sealing.js';

export interface DocumentDeps {
  documents: DocumentRepository;
  documentMetadataProposals: DocumentMetadataProposalRepository;
  documentTypes: DocumentTypeRepository;
  storage: StoragePort;
  ids: IdGenerator;
  pdfSealing?: PdfSealingDeps;
}

export type DocumentUpdateResult =
  | {
      outcome: 'updated';
      document: Document;
      proposal: null;
    }
  | {
      outcome: 'proposed';
      document: Document;
      proposal: DocumentMetadataProposalListItem;
    };

export type FileUploadTarget =
  | { kind: 'direct'; key: string; target: UploadTarget }
  | { kind: 'server'; key: string };

export interface FileContent {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

export interface ExportFileContent extends FileContent {
  document: Document;
  file: DocumentFile;
}

export interface ExportDocumentContent {
  document: Document;
  files: Array<{ file: DocumentFile; bytes: Uint8Array }>;
}

const findDocument = async (
  tenantId: string,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const found = await deps.documents.findById(tenantId, documentId);
  return found ? ok(found) : err(notFound('Document not found'));
};

const validateDocumentType = async (
  tenantId: string,
  slug: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> =>
  (await deps.documentTypes.findBySlug(tenantId, slug))
    ? ok(undefined)
    : err(validation('Unknown document type'));

const tokenHasWrite = (ctx: Ctx): boolean =>
  ctx.identity.apiToken?.scopes.includes('write') ?? false;

const tokenNeedsDraftDocument = (ctx: Ctx): boolean =>
  ctx.identity.apiToken !== null && !tokenHasWrite(ctx);

const forbidTokenDelete = (ctx: Ctx): Result<void, AppError> | null =>
  ctx.identity.apiToken === null
    ? null
    : err(forbidden('API tokens cannot delete documents or files'));

const requireDraftDocumentForToken = async (
  ctx: Ctx,
  tenantId: string,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const document = await findDocument(tenantId, documentId, deps);
  if (!document.ok) return document;
  return !tokenNeedsDraftDocument(ctx) || document.value.draft
    ? document
    : err(forbidden('write:draft tokens can only modify draft documents'));
};

export const createDocument = async (
  ctx: Ctx,
  input: CreateDocument,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  const validDocumentType = await validateDocumentType(scope.value, parsed.data.docType, deps);
  if (!validDocumentType.ok) return validDocumentType;
  if (tokenNeedsDraftDocument(ctx) && parsed.data.draft !== true) {
    return err(forbidden('write:draft tokens can only create draft documents'));
  }
  return ok(
    await deps.documents.create({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      ...parsed.data,
      periodStart: parsed.data.periodStart ?? null,
      periodEnd: parsed.data.periodEnd ?? null,
      person: parsed.data.person ?? null,
      draft: parsed.data.draft ?? false,
    }),
  );
};

export const listDocuments = async (
  ctx: Ctx,
  filter: DocumentListFilter,
  deps: DocumentDeps,
): Promise<Result<DocumentListItem[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const parsed = documentListFilterSchema.safeParse(filter);
  if (!parsed.success) return err(validation('Invalid document filters', parsed.error.flatten()));
  const documents = await deps.documents.listByTenant(scope.value, parsed.data);
  const files = await deps.documents.listFilesForDocuments(
    scope.value,
    documents.map((document) => document.id),
  );
  return ok(
    documents.map((document) => ({
      ...document,
      files: files.filter((file) => file.documentId === document.id),
    })),
  );
};

export const getDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<DocumentDetail, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const document = await deps.documents.findAnyById(scope.value, documentId);
  if (!document) return err(notFound('Document not found'));
  const [files, pendingDrafts] = await Promise.all([
    deps.documents.listFilesIncludingDeleted(scope.value, documentId),
    deps.documents.getPendingDraftCounts(scope.value, documentId),
  ]);
  return ok({ ...document, files, pendingDrafts });
};

export const listTrashedDocuments = async (
  ctx: Ctx,
  deps: DocumentDeps,
): Promise<Result<DocumentWithFiles[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const documents = await deps.documents.listDeletedByTenant(scope.value);
  const filesByDocument = await Promise.all(
    documents.map((document) =>
      deps.documents.listFilesIncludingDeleted(scope.value, document.id),
    ),
  );
  return ok(
    documents.map((document, index) => ({
      ...document,
      files: filesByDocument[index] ?? [],
    })),
  );
};

export const updateDocument = async (
  ctx: Ctx,
  documentId: string,
  input: unknown,
  deps: DocumentDeps,
): Promise<Result<DocumentUpdateResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  if (tokenNeedsDraftDocument(ctx)) {
    const fullUpdate = updateDocumentSchema.safeParse(input);
    const parsedChanges = documentMetadataChangesSchema.safeParse(
      fullUpdate.success
        ? {
            ...fullUpdate.data,
            periodStart: fullUpdate.data.periodStart ?? null,
            periodEnd: fullUpdate.data.periodEnd ?? null,
            person: fullUpdate.data.person ?? null,
          }
        : input,
    );
    if (!parsedChanges.success) {
      return err(validation('Invalid document metadata proposal', parsedChanges.error.flatten()));
    }
    const validDocumentType = parsedChanges.data.docType === undefined
      ? ok(undefined)
      : await validateDocumentType(scope.value, parsedChanges.data.docType, deps);
    if (!validDocumentType.ok) return validDocumentType;
    const document = await findDocument(scope.value, documentId, deps);
    if (!document.ok) return document;
    const proposed = parsedChanges.data;
    const changes: DocumentMetadataChanges = {
      ...(proposed.title === undefined || proposed.title === document.value.title
        ? {}
        : { title: proposed.title }),
      ...(proposed.docType === undefined || proposed.docType === document.value.docType
        ? {}
        : { docType: proposed.docType }),
      ...(proposed.documentDate === undefined ||
      proposed.documentDate === document.value.documentDate
        ? {}
        : { documentDate: proposed.documentDate }),
      ...(proposed.periodStart === undefined ||
      proposed.periodStart === document.value.periodStart
        ? {}
        : { periodStart: proposed.periodStart }),
      ...(proposed.periodEnd === undefined || proposed.periodEnd === document.value.periodEnd
        ? {}
        : { periodEnd: proposed.periodEnd }),
      ...(proposed.person === undefined || proposed.person === document.value.person
        ? {}
        : { person: proposed.person }),
      ...(proposed.tags === undefined ||
      JSON.stringify(proposed.tags) === JSON.stringify(document.value.tags)
        ? {}
        : { tags: proposed.tags }),
    };
    const changed = documentMetadataChangesSchema.safeParse(changes);
    if (!changed.success) {
      return err(validation('Document metadata is unchanged'));
    }
    const proposal = await deps.documentMetadataProposals.create({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      documentId,
      changes: changed.data,
      creatorAccountId: ctx.identity.userId,
    });
    return ok({ outcome: 'proposed', document: document.value, proposal });
  }
  const parsed = updateDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  const validDocumentType = await validateDocumentType(scope.value, parsed.data.docType, deps);
  if (!validDocumentType.ok) return validDocumentType;
  const normalized = {
    ...parsed.data,
    periodStart: parsed.data.periodStart ?? null,
    periodEnd: parsed.data.periodEnd ?? null,
    person: parsed.data.person ?? null,
  };
  const updated = await deps.documents.update(scope.value, documentId, {
    ...normalized,
  });
  return updated
    ? ok({ outcome: 'updated', document: updated, proposal: null })
    : err(notFound('Document not found'));
};

export const approveDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const approved = await deps.documents.approve(scope.value, documentId);
  return approved ? ok(approved) : err(notFound('Document not found'));
};

export const unapproveDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const unapproved = await deps.documents.unapprove(scope.value, documentId);
  return unapproved ? ok(unapproved) : err(notFound('Document not found'));
};

export const waiveDocumentSignature = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const waived = await deps.documents.waiveSignature(scope.value, documentId);
  return waived ? ok(waived) : err(notFound('Document not found'));
};

export const requireDocumentSignature = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:approve');
  if (!scope.ok) return scope;
  const required = await deps.documents.requireSignature(scope.value, documentId);
  return required ? ok(required) : err(notFound('Document not found'));
};

export const deleteDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const tokenDeleteDenial = forbidTokenDelete(ctx);
  if (tokenDeleteDenial) return tokenDeleteDenial;
  const deleted = await deps.documents.delete(scope.value, documentId);
  return deleted ? ok(undefined) : err(notFound('Document not found'));
};

export const restoreDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const active = await deps.documents.findById(scope.value, documentId);
  if (active) return ok(active);
  const deleted = await deps.documents.findDeletedById(scope.value, documentId);
  if (!deleted) return err(notFound('Document not found'));
  const restored = await deps.documents.restore(scope.value, documentId);
  return restored ? ok(restored) : err(notFound('Document not found'));
};

export const purgeDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const tokenDeleteDenial = forbidTokenDelete(ctx);
  if (tokenDeleteDenial) return tokenDeleteDenial;
  const document = await deps.documents.findAnyById(scope.value, documentId);
  if (!document) return ok(undefined);
  const files = await deps.documents.listAllFilesIncludingDeleted(
    scope.value,
    documentId,
  );
  for (const file of files) {
    const removed = await deps.storage.delete(file.storageKey);
    if (!removed.ok) return removed;
  }
  await deps.documents.purge(scope.value, documentId);
  return ok(undefined);
};

const storageKey = (tenantId: string, documentId: string, fileId: string): string =>
  `documents/${tenantId}/${documentId}/${fileId}`;

const requestUpload = async (
  tenantId: string,
  documentId: string,
  input: FileUploadRequest,
  deps: DocumentDeps,
): Promise<Result<FileUploadTarget, AppError>> => {
  const parsed = fileUploadRequestSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid file upload request', parsed.error.flatten()));
  const document = await findDocument(tenantId, documentId, deps);
  if (!document.ok) return document;
  const key = storageKey(tenantId, documentId, deps.ids.nextId());
  const target = await deps.storage.createUploadUrl(key, parsed.data.contentType);
  if (!target.ok) return target;
  return target.value ? ok({ kind: 'direct', key, target: target.value }) : ok({ kind: 'server', key });
};

export const requestFileUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FileUploadRequest,
  deps: DocumentDeps,
): Promise<Result<FileUploadTarget, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const document = await requireDraftDocumentForToken(ctx, scope.value, documentId, deps);
  if (!document.ok) return document;
  return requestUpload(scope.value, documentId, input, deps);
};

const finalizeUpload = async (
  tenantId: string,
  documentId: string,
  signedBy: string,
  input: FinalizeFileUpload,
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const parsed = finalizeFileUploadSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid uploaded file', parsed.error.flatten()));
  const expectedPrefix = `documents/${tenantId}/${documentId}/`;
  if (!parsed.data.key.startsWith(expectedPrefix)) return err(validation('Invalid storage key'));
  const metadata = await deps.storage.head(parsed.data.key);
  if (!metadata.ok) return metadata;
  if (!metadata.value) return err(notFound('Uploaded file not found'));
  if (
    metadata.value.contentType !== parsed.data.contentType ||
    metadata.value.sizeBytes !== parsed.data.sizeBytes
  ) {
    return err(validation('Uploaded file metadata does not match the declared upload'));
  }
  const document = await deps.documents.findById(tenantId, documentId);
  if (!document) return err(notFound('Document not found'));
  let sizeBytes = metadata.value.sizeBytes;
  let sealMetadata;
  if (parsed.data.role === 'signed-digital' && deps.pdfSealing) {
    const dateMode = await preparePdfSeal(
      { tenantId, documentId },
      deps.pdfSealing,
    );
    if (dateMode) {
      const storedBytes = await deps.storage.get(parsed.data.key);
      if (storedBytes.ok && storedBytes.value) {
        const sealed = await attemptPdfSeal(
          {
            tenantId,
            document,
            bytes: storedBytes.value,
            dateMode,
            contributorAccountIds: parsed.data.contributorAccountIds ?? [signedBy],
          },
          deps.pdfSealing,
        );
        if (sealed) {
          const replaced = await deps.storage.put(
            parsed.data.key,
            sealed.bytes,
            metadata.value.contentType,
          );
          if (replaced.ok) {
            sizeBytes = sealed.bytes.byteLength;
            sealMetadata = sealed.metadata;
          } else {
            deps.pdfSealing.warnings.warn('Sealed PDF could not replace the uploaded artifact', {
              tenantId,
              documentId,
              storageKey: parsed.data.key,
              error: replaced.error.message,
            });
          }
        }
      } else if (!storedBytes.ok) {
        deps.pdfSealing.warnings.warn('Uploaded PDF could not be read for sealing', {
          tenantId,
          documentId,
          storageKey: parsed.data.key,
          error: storedBytes.error.message,
        });
      }
    }
  }
  const fileId = deps.ids.nextId();
  const created = await deps.documents.createFile(tenantId, {
    id: fileId,
    documentId,
    role: parsed.data.role,
    fileName: parsed.data.fileName,
    contentType: metadata.value.contentType,
    sizeBytes,
    storageKey: parsed.data.key,
  });
  if (created && sealMetadata && deps.pdfSealing) {
    await recordPdfSeal(
      { tenantId, documentId, fileId, signedBy, metadata: sealMetadata },
      deps.pdfSealing,
    );
  }
  return created ? ok(created) : err(notFound('Document not found'));
};

export const finalizeFileUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FinalizeFileUpload,
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const document = await requireDraftDocumentForToken(ctx, scope.value, documentId, deps);
  if (!document.ok) return document;
  return finalizeUpload(scope.value, documentId, ctx.identity.userId, input, deps);
};

export const serverUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FileUploadRequest & { bytes: Uint8Array },
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const document = await requireDraftDocumentForToken(ctx, scope.value, documentId, deps);
  if (!document.ok) return document;
  const requested = await requestUpload(scope.value, documentId, input, deps);
  if (!requested.ok) return requested;
  const stored = await deps.storage.put(requested.value.key, input.bytes, input.contentType);
  if (!stored.ok) return stored;
  const finalized = await finalizeUpload(
    scope.value,
    documentId,
    ctx.identity.userId,
    {
      key: requested.value.key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      role: input.role,
      ...(input.contributorAccountIds
        ? { contributorAccountIds: input.contributorAccountIds }
        : {}),
    },
    deps,
  );
  if (finalized.ok) return finalized;
  await deps.storage.delete(requested.value.key);
  return finalized;
};

export const removeFile = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const tokenDeleteDenial = forbidTokenDelete(ctx);
  if (tokenDeleteDenial) return tokenDeleteDenial;
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  const removed = await deps.storage.delete(file.storageKey);
  if (!removed.ok) return removed;
  const deleted = await deps.documents.deleteFile(scope.value, documentId, fileId);
  return deleted ? ok(undefined) : err(notFound('Document file not found'));
};

export const moveDocumentFile = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  input: MoveDocumentFile,
  deps: DocumentDeps,
): Promise<Result<DocumentWithFiles, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = moveDocumentFileSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document payload', parsed.error.flatten()));
  const validDocumentType = await validateDocumentType(scope.value, parsed.data.docType, deps);
  if (!validDocumentType.ok) return validDocumentType;
  const source = await findDocument(scope.value, documentId, deps);
  if (!source.ok) return source;
  if (tokenNeedsDraftDocument(ctx) && !source.value.draft) {
    return err(forbidden('write:draft tokens can only modify draft documents'));
  }
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  const created = await deps.documents.create({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    title: parsed.data.title,
    docType: parsed.data.docType,
    documentDate: parsed.data.documentDate ?? source.value.documentDate,
    periodStart:
      parsed.data.periodStart === undefined ? source.value.periodStart : parsed.data.periodStart,
    periodEnd:
      parsed.data.periodEnd === undefined ? source.value.periodEnd : parsed.data.periodEnd,
    person: source.value.person,
    tags: source.value.tags,
    draft: source.value.draft,
  });
  const moved = await deps.documents.moveFileToDocument(
    scope.value,
    documentId,
    file.id,
    created.id,
  );
  if (!moved) {
    await deps.documents.purge(scope.value, created.id);
    return err(notFound('Document file not found'));
  }
  return ok({ ...created, files: [moved] });
};

export const getFileContent = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  deps: DocumentDeps,
): Promise<Result<FileContent, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  const bytes = await deps.storage.get(file.storageKey);
  if (!bytes.ok) return bytes;
  if (!bytes.value) return err(notFound('Document file content not found'));
  return ok({
    bytes: bytes.value,
    contentType: file.contentType,
    fileName: file.fileName,
  });
};

export const getFileExport = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  deps: DocumentDeps,
): Promise<Result<ExportFileContent, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const document = await findDocument(scope.value, documentId, deps);
  if (!document.ok) return document;
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  const bytes = await deps.storage.get(file.storageKey);
  if (!bytes.ok) return bytes;
  if (!bytes.value) return err(notFound('Document file content not found'));
  return ok({
    document: document.value,
    file,
    bytes: bytes.value,
    contentType: file.contentType,
    fileName: file.fileName,
  });
};

export const exportDocuments = async (
  ctx: Ctx,
  input: ExportDocuments,
  deps: DocumentDeps,
): Promise<Result<ExportDocumentContent[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const parsed = exportDocumentsSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid export request', parsed.error.flatten()));
  const exported: ExportDocumentContent[] = [];
  let exportedBytes = 0;
  for (const documentId of parsed.data.documentIds) {
    const document = await deps.documents.findById(scope.value, documentId);
    if (!document) continue;
    const files = await deps.documents.listFiles(scope.value, documentId);
    const fileCount = exported.reduce((count, item) => count + item.files.length, 0);
    if (fileCount + files.length > MAX_DOCUMENT_EXPORT_FILES) {
      return err(validation(`An export may contain at most ${MAX_DOCUMENT_EXPORT_FILES} files`));
    }
    const exportedFiles: Array<{ file: DocumentFile; bytes: Uint8Array }> = [];
    for (const file of files) {
      if (exportedBytes + file.sizeBytes > MAX_DOCUMENT_EXPORT_BYTES) {
        return err(
          exportTooLarge(
            `An export may contain at most ${MAX_DOCUMENT_EXPORT_BYTES} uncompressed bytes`,
          ),
        );
      }
      const bytes = await deps.storage.get(file.storageKey);
      if (!bytes.ok) return bytes;
      if (!bytes.value) return err(notFound('Document file content not found'));
      exportedFiles.push({ file, bytes: bytes.value });
      exportedBytes += file.sizeBytes;
    }
    exported.push({ document, files: exportedFiles });
  }
  return exported.length ? ok(exported) : err(notFound('Documents not found'));
};
