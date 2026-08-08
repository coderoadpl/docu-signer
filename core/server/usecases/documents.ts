import {
  createDocumentSchema,
  documentListFilterSchema,
  err,
  exportDocumentsSchema,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
  MAX_DOCUMENT_EXPORT_FILES,
  notFound,
  ok,
  updateDocumentSchema,
  validation,
  type AppError,
  type CreateDocument,
  type Document,
  type DocumentFile,
  type DocumentListFilter,
  type DocumentWithFiles,
  type ExportDocuments,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type Result,
  type UpdateDocument,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DocumentRepository, IdGenerator, StoragePort, UploadTarget } from '../ports.js';

export interface DocumentDeps {
  documents: DocumentRepository;
  storage: StoragePort;
  ids: IdGenerator;
}

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

export const createDocument = async (
  ctx: Ctx,
  input: CreateDocument,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  return ok(
    await deps.documents.create({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      ...parsed.data,
      person: parsed.data.person ?? null,
    }),
  );
};

export const listDocuments = async (
  ctx: Ctx,
  filter: DocumentListFilter,
  deps: DocumentDeps,
): Promise<Result<DocumentWithFiles[], AppError>> => {
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
): Promise<Result<DocumentWithFiles, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const document = await findDocument(scope.value, documentId, deps);
  if (!document.ok) return document;
  const files = await deps.documents.listFiles(scope.value, documentId);
  return ok({ ...document.value, files });
};

export const updateDocument = async (
  ctx: Ctx,
  documentId: string,
  input: UpdateDocument,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = updateDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  const updated = await deps.documents.update(scope.value, documentId, {
    ...parsed.data,
    person: parsed.data.person ?? null,
  });
  return updated ? ok(updated) : err(notFound('Document not found'));
};

export const deleteDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const document = await findDocument(scope.value, documentId, deps);
  if (!document.ok) return document;
  const files = await deps.documents.listFiles(scope.value, documentId);
  for (const file of files) {
    const removed = await deps.storage.delete(file.storageKey);
    if (!removed.ok) return removed;
  }
  const deleted = await deps.documents.delete(scope.value, documentId);
  return deleted ? ok(undefined) : err(notFound('Document not found'));
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
  return requestUpload(scope.value, documentId, input, deps);
};

const finalizeUpload = async (
  tenantId: string,
  documentId: string,
  input: FinalizeFileUpload,
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const parsed = finalizeFileUploadSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid uploaded file', parsed.error.flatten()));
  const expectedPrefix = `documents/${tenantId}/${documentId}/`;
  if (!parsed.data.key.startsWith(expectedPrefix)) return err(validation('Invalid storage key'));
  const exists = await deps.storage.exists(parsed.data.key);
  if (!exists.ok) return exists;
  if (!exists.value) return err(notFound('Uploaded file not found'));
  const created = await deps.documents.createFile(tenantId, {
    id: deps.ids.nextId(),
    documentId,
    role: parsed.data.role,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    storageKey: parsed.data.key,
  });
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
  return finalizeUpload(scope.value, documentId, input, deps);
};

export const serverUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FileUploadRequest & { bytes: Uint8Array },
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const requested = await requestUpload(scope.value, documentId, input, deps);
  if (!requested.ok) return requested;
  const stored = await deps.storage.put(requested.value.key, input.bytes, input.contentType);
  if (!stored.ok) return stored;
  const finalized = await finalizeUpload(
    scope.value,
    documentId,
    {
      key: requested.value.key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      role: input.role,
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
  const file = await deps.documents.findFile(scope.value, documentId, fileId);
  if (!file) return err(notFound('Document file not found'));
  const removed = await deps.storage.delete(file.storageKey);
  if (!removed.ok) return removed;
  const deleted = await deps.documents.deleteFile(scope.value, documentId, fileId);
  return deleted ? ok(undefined) : err(notFound('Document file not found'));
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
      const bytes = await deps.storage.get(file.storageKey);
      if (!bytes.ok) return bytes;
      if (!bytes.value) return err(notFound('Document file content not found'));
      exportedFiles.push({ file, bytes: bytes.value });
    }
    exported.push({ document, files: exportedFiles });
  }
  return exported.length ? ok(exported) : err(notFound('Documents not found'));
};
