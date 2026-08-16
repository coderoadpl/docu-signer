import {
  appError,
  createDocumentTypeSchema,
  documentTypeSchema,
  err,
  notFound,
  ok,
  renameDocumentTypeSchema,
  validation,
  type AppError,
  type CreateDocumentType,
  type DocumentType,
  type RenameDocumentType,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DocumentTypeRepository } from '../ports.js';

export interface DocumentTypeDeps {
  documentTypes: DocumentTypeRepository;
}

export const documentTypeSlugFromLabel = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ł]/gu, 'l')
    .replace(/[\p{M}]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 64)
    .replace(/-$/u, '');

export const listDocumentTypes = async (
  ctx: Ctx,
  deps: DocumentTypeDeps,
): Promise<Result<DocumentType[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  return ok(await deps.documentTypes.listByTenant(scope.value));
};

export const createDocumentType = async (
  ctx: Ctx,
  input: CreateDocumentType,
  deps: DocumentTypeDeps,
): Promise<Result<DocumentType, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsed = createDocumentTypeSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid document type', parsed.error.flatten()));
  const slug = documentTypeSlugFromLabel(parsed.data.label);
  const parsedSlug = documentTypeSchema.safeParse(slug);
  if (!parsedSlug.success) return err(validation('Document type label cannot form a valid slug'));
  const existing = await deps.documentTypes.findBySlug(scope.value, parsedSlug.data);
  if (existing) return err(appError('conflict', 'Document type slug already exists'));
  const current = await deps.documentTypes.listByTenant(scope.value);
  const position = current.length === 0
    ? 10
    : Math.max(...current.map((item) => item.position)) + 10;
  const created = await deps.documentTypes.create({
    tenantId: scope.value,
    slug: parsedSlug.data,
    label: parsed.data.label,
    position,
  });
  return created
    ? ok(created)
    : err(appError('conflict', 'Document type slug already exists'));
};

export const renameDocumentType = async (
  ctx: Ctx,
  slug: string,
  input: RenameDocumentType,
  deps: DocumentTypeDeps,
): Promise<Result<DocumentType, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsedSlug = documentTypeSchema.safeParse(slug);
  const parsed = renameDocumentTypeSchema.safeParse(input);
  if (!parsedSlug.success || !parsed.success) {
    return err(validation('Invalid document type', {
      slug: parsedSlug.success ? undefined : parsedSlug.error.flatten(),
      input: parsed.success ? undefined : parsed.error.flatten(),
    }));
  }
  const renamed = await deps.documentTypes.rename(scope.value, parsedSlug.data, parsed.data.label);
  return renamed ? ok(renamed) : err(notFound('Document type not found'));
};

export const deleteDocumentType = async (
  ctx: Ctx,
  slug: string,
  deps: DocumentTypeDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsedSlug = documentTypeSchema.safeParse(slug);
  if (!parsedSlug.success) return err(validation('Invalid document type slug', parsedSlug.error.flatten()));
  const used = await deps.documentTypes.isUsedByAnyDocument(scope.value, parsedSlug.data);
  if (used) return err(appError('conflict', 'Document type is used by a document'));
  const deleted = await deps.documentTypes.delete(scope.value, parsedSlug.data);
  return deleted ? ok(undefined) : err(notFound('Document type not found'));
};
