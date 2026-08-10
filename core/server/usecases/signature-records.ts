import {
  appError,
  createSignatureRecordSchema,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  err,
  notFound,
  ok,
  paginationQuerySchema,
  signatureRecordSchema,
  signatureRecordCursorSchema,
  validation,
  type AppError,
  type CreateSignatureRecord,
  type Result,
  type SignatureRecord,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  DocumentRepository,
  IdGenerator,
  SignatureRecordRepository,
} from '../ports.js';

export interface SignatureRecordDeps {
  documents: DocumentRepository;
  ids: IdGenerator;
  signatureRecords: SignatureRecordRepository;
}

export const listSignatureRecords = async (
  ctx: Ctx,
  documentId: string,
  input: unknown,
  deps: Pick<SignatureRecordDeps, 'documents' | 'signatureRecords'>,
): Promise<Result<{ items: SignatureRecord[]; nextCursor: string | null }, AppError>> => {
  const scope = authorizeTenant(ctx, 'signature-record:manage');
  if (!scope.ok) return scope;
  const parsedDocumentId = signatureRecordSchema.shape.documentId.safeParse(documentId);
  if (!parsedDocumentId.success) return err(validation('Invalid document id'));
  const parsedInput = paginationQuerySchema.safeParse(input);
  if (!parsedInput.success) {
    return err(validation('Invalid signature record pagination', parsedInput.error.flatten()));
  }
  const cursor = parsedInput.data.cursor
    ? signatureRecordCursorSchema.safeParse(decodeOpaqueCursor(parsedInput.data.cursor))
    : null;
  if (cursor && !cursor.success) return err(validation('Invalid signature record cursor'));
  if (!(await deps.documents.findById(scope.value, parsedDocumentId.data))) {
    return err(notFound('Document not found'));
  }
  const rows = await deps.signatureRecords.listByDocument(
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

export const createSignatureRecord = async (
  ctx: Ctx,
  documentId: string,
  input: CreateSignatureRecord,
  deps: SignatureRecordDeps,
): Promise<Result<SignatureRecord, AppError>> => {
  const scope = authorizeTenant(ctx, 'signature-record:manage');
  if (!scope.ok) return scope;
  const parsedDocumentId = signatureRecordSchema.shape.documentId.safeParse(documentId);
  if (!parsedDocumentId.success) return err(validation('Invalid document id'));
  const parsed = createSignatureRecordSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid signature record', parsed.error.flatten()));
  }
  const file = await deps.documents.findFile(
    scope.value,
    parsedDocumentId.data,
    parsed.data.fileId,
  );
  if (!file) return err(notFound('Signed document file not found'));
  if (file.role !== 'signed-digital') {
    return err(validation('Signature records require a signed-digital file'));
  }
  const record = await deps.signatureRecords.create({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    documentId: parsedDocumentId.data,
    fileId: parsed.data.fileId,
    signedBy: ctx.identity.userId,
    payload: parsed.data.payload,
  });
  return record
    ? ok(record)
    : err(appError('conflict', 'Signature record already exists'));
};
