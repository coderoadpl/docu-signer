import { z } from 'zod';

export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENT_EXPORT_DOCUMENTS = 100;
export const MAX_DOCUMENT_EXPORT_FILES = 100;
export const MAX_DOCUMENT_EXPORT_BYTES = 256 * 1024 * 1024;

export const documentTypeSchema = z.enum([
  'umowa-uod',
  'uchwala',
  'protokol',
  'rachunek',
  'inny',
]);

export type DocumentType = z.infer<typeof documentTypeSchema>;

const documentFileRoleSchema = z.enum([
  'source',
  'signed-scan',
  'signed-digital',
  'other',
]);

export type DocumentFileRole = z.infer<typeof documentFileRoleSchema>;

export const documentSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  title: z.string().min(1).max(300),
  docType: documentTypeSchema,
  documentDate: z.iso.date(),
  person: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Document = z.infer<typeof documentSchema>;

export const documentFileSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  role: documentFileRoleSchema,
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type DocumentFile = z.infer<typeof documentFileSchema>;

export const documentWithFilesSchema = documentSchema.extend({
  files: z.array(documentFileSchema),
});

export type DocumentWithFiles = z.infer<typeof documentWithFilesSchema>;

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(300, 'Title too long'),
  docType: documentTypeSchema,
  documentDate: z.iso.date(),
  person: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export type CreateDocument = z.input<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentSchema.extend({});

export type UpdateDocument = z.input<typeof updateDocumentSchema>;

export const documentListFilterSchema = z
  .object({
    docType: documentTypeSchema.optional(),
    person: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
  })
  .refine(
    (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    'dateFrom must not be after dateTo',
  );

export type DocumentListFilter = z.input<typeof documentListFilterSchema>;

const isAllowedDocumentContentType = (contentType: string): boolean => {
  const normalized = contentType.trim().toLowerCase();
  return (
    normalized === 'application/pdf' ||
    (normalized.startsWith('image/') && normalized.length > 'image/'.length)
  );
};

const documentUploadContentTypeSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isAllowedDocumentContentType, 'Only PDF and image files are allowed');

export const fileUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1),
  contentType: documentUploadContentTypeSchema,
  role: documentFileRoleSchema,
});

export type FileUploadRequest = z.infer<typeof fileUploadRequestSchema>;

export const finalizeFileUploadSchema = z.object({
  key: z.string().min(1),
  fileName: z.string().trim().min(1),
  contentType: documentUploadContentTypeSchema,
  sizeBytes: z.number().int().nonnegative().max(MAX_DOCUMENT_FILE_BYTES),
  role: documentFileRoleSchema,
});

export type FinalizeFileUpload = z.infer<typeof finalizeFileUploadSchema>;

export const exportDocumentsSchema = z.object({
  documentIds: z
    .array(z.uuid())
    .min(1)
    .max(
      MAX_DOCUMENT_EXPORT_DOCUMENTS,
      `An export may contain at most ${MAX_DOCUMENT_EXPORT_DOCUMENTS} documents`,
    ),
});

export type ExportDocuments = z.infer<typeof exportDocumentsSchema>;
