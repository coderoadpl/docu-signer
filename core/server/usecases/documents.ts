import {
  createDocumentSchema,
  documentListFilterSchema,
  err,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
  notFound,
  ok,
  tenantNotFound,
  updateDocumentSchema,
  validation,
  type AppError,
  type CreateDocument,
  type Document,
  type DocumentFile,
  type DocumentListFilter,
  type DocumentWithFiles,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type Result,
  type UpdateDocument,
} from '#core/domain/index.js';

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

const tenantIdFrom = (ctx: Ctx, action: string): Result<string, AppError> =>
  ctx.identity.tenantId
    ? ok(ctx.identity.tenantId)
    : err(tenantNotFound(`Select a tenant to ${action}`));

const findDocument = async (
  tenantId: string,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const found = await deps.documents.findById(tenantId, documentId);
  if (!found.ok) return found;
  return found.value ? ok(found.value) : err(notFound('Document not found'));
};

export const createDocument = async (
  ctx: Ctx,
  input: CreateDocument,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'create documents');
  if (!tenantId.ok) return tenantId;
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  return deps.documents.create({ id: deps.ids.nextId(), tenantId: tenantId.value, ...parsed.data });
};

export const listDocuments = async (
  ctx: Ctx,
  filter: DocumentListFilter,
  deps: DocumentDeps,
): Promise<Result<DocumentWithFiles[], AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'list documents');
  if (!tenantId.ok) return tenantId;
  const parsed = documentListFilterSchema.safeParse(filter);
  if (!parsed.success) return err(validation('Invalid document filters', parsed.error.flatten()));
  const documents = await deps.documents.listByTenant(tenantId.value, parsed.data);
  if (!documents.ok) return documents;
  const files = await deps.documents.listFilesForDocuments(
    tenantId.value,
    documents.value.map((document) => document.id),
  );
  if (!files.ok) return files;
  return ok(
    documents.value.map((document) => ({
      ...document,
      files: files.value.filter((file) => file.documentId === document.id),
    })),
  );
};

export const getDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<DocumentWithFiles, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'read documents');
  if (!tenantId.ok) return tenantId;
  const document = await findDocument(tenantId.value, documentId, deps);
  if (!document.ok) return document;
  const files = await deps.documents.listFiles(tenantId.value, documentId);
  return files.ok ? ok({ ...document.value, files: files.value }) : files;
};

export const updateDocument = async (
  ctx: Ctx,
  documentId: string,
  input: UpdateDocument,
  deps: DocumentDeps,
): Promise<Result<Document, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'update documents');
  if (!tenantId.ok) return tenantId;
  const parsed = updateDocumentSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document', parsed.error.flatten()));
  const updated = await deps.documents.update(tenantId.value, documentId, parsed.data);
  if (!updated.ok) return updated;
  return updated.value ? ok(updated.value) : err(notFound('Document not found'));
};

export const deleteDocument = async (
  ctx: Ctx,
  documentId: string,
  deps: DocumentDeps,
): Promise<Result<void, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'delete documents');
  if (!tenantId.ok) return tenantId;
  const document = await findDocument(tenantId.value, documentId, deps);
  if (!document.ok) return document;
  const files = await deps.documents.listFiles(tenantId.value, documentId);
  if (!files.ok) return files;
  for (const file of files.value) {
    const removed = await deps.storage.delete(file.storageKey);
    if (!removed.ok) return removed;
  }
  const deleted = await deps.documents.delete(tenantId.value, documentId);
  if (!deleted.ok) return deleted;
  return deleted.value ? ok(undefined) : err(notFound('Document not found'));
};

const storageKey = (tenantId: string, documentId: string, fileId: string): string =>
  `documents/${tenantId}/${documentId}/${fileId}`;

export const requestFileUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FileUploadRequest,
  deps: DocumentDeps,
): Promise<Result<FileUploadTarget, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'attach files');
  if (!tenantId.ok) return tenantId;
  const parsed = fileUploadRequestSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid file upload request', parsed.error.flatten()));
  const document = await findDocument(tenantId.value, documentId, deps);
  if (!document.ok) return document;
  const key = storageKey(tenantId.value, documentId, deps.ids.nextId());
  const target = await deps.storage.createUploadUrl(key, parsed.data.contentType);
  if (!target.ok) return target;
  return target.value ? ok({ kind: 'direct', key, target: target.value }) : ok({ kind: 'server', key });
};

export const finalizeFileUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FinalizeFileUpload,
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'attach files');
  if (!tenantId.ok) return tenantId;
  const parsed = finalizeFileUploadSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid uploaded file', parsed.error.flatten()));
  const expectedPrefix = `documents/${tenantId.value}/${documentId}/`;
  if (!parsed.data.key.startsWith(expectedPrefix)) return err(validation('Invalid storage key'));
  const document = await findDocument(tenantId.value, documentId, deps);
  if (!document.ok) return document;
  const exists = await deps.storage.exists(parsed.data.key);
  if (!exists.ok) return exists;
  if (!exists.value) return err(notFound('Uploaded file not found'));
  const created = await deps.documents.createFile(tenantId.value, {
    id: deps.ids.nextId(),
    documentId,
    role: parsed.data.role,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    storageKey: parsed.data.key,
  });
  if (!created.ok) return created;
  return created.value ? ok(created.value) : err(notFound('Document not found'));
};

export const serverUpload = async (
  ctx: Ctx,
  documentId: string,
  input: FileUploadRequest & { bytes: Uint8Array },
  deps: DocumentDeps,
): Promise<Result<DocumentFile, AppError>> => {
  const requested = await requestFileUpload(ctx, documentId, input, deps);
  if (!requested.ok) return requested;
  const stored = await deps.storage.put(requested.value.key, input.bytes, input.contentType);
  if (!stored.ok) return stored;
  const finalized = await finalizeFileUpload(
    ctx,
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
  const tenantId = tenantIdFrom(ctx, 'remove files');
  if (!tenantId.ok) return tenantId;
  const file = await deps.documents.findFile(tenantId.value, documentId, fileId);
  if (!file.ok) return file;
  if (!file.value) return err(notFound('Document file not found'));
  const removed = await deps.storage.delete(file.value.storageKey);
  if (!removed.ok) return removed;
  const deleted = await deps.documents.deleteFile(tenantId.value, documentId, fileId);
  if (!deleted.ok) return deleted;
  return deleted.value ? ok(undefined) : err(notFound('Document file not found'));
};

export const getFileContent = async (
  ctx: Ctx,
  documentId: string,
  fileId: string,
  deps: DocumentDeps,
): Promise<Result<FileContent, AppError>> => {
  const tenantId = tenantIdFrom(ctx, 'read files');
  if (!tenantId.ok) return tenantId;
  const file = await deps.documents.findFile(tenantId.value, documentId, fileId);
  if (!file.ok) return file;
  if (!file.value) return err(notFound('Document file not found'));
  const bytes = await deps.storage.get(file.value.storageKey);
  if (!bytes.ok) return bytes;
  if (!bytes.value) return err(notFound('Document file content not found'));
  return ok({
    bytes: bytes.value,
    contentType: file.value.contentType,
    fileName: file.value.fileName,
  });
};
