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

export const documentSignatureStatusSchema = z.enum(['needs-signature', 'signed']);

export type DocumentSignatureStatus = z.infer<typeof documentSignatureStatusSchema>;

const periodIsOrdered = (value: {
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
}): boolean =>
  !value.periodStart || !value.periodEnd || value.periodStart <= value.periodEnd;

const documentFieldsSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  title: z.string().min(1).max(300),
  docType: documentTypeSchema,
  documentDate: z.iso.date(),
  periodStart: z.iso.date().nullable(),
  periodEnd: z.iso.date().nullable(),
  person: z.string().nullable(),
  tags: z.array(z.string()),
  draft: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable().default(null),
});

export const documentSchema = documentFieldsSchema.refine(
  periodIsOrdered,
  'periodStart must not be after periodEnd',
);

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

export const documentWithFilesSchema = documentFieldsSchema
  .extend({
    files: z.array(documentFileSchema),
  })
  .refine(periodIsOrdered, 'periodStart must not be after periodEnd');

export type DocumentWithFiles = z.infer<typeof documentWithFilesSchema>;

const createDocumentFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(300, 'Title too long'),
  docType: documentTypeSchema,
  documentDate: z.iso.date(),
  periodStart: z.iso.date().nullable().optional(),
  periodEnd: z.iso.date().nullable().optional(),
  person: z.string().trim().min(1).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const createDocumentSchema = createDocumentFieldsSchema
  .extend({ draft: z.boolean().optional() })
  .refine(periodIsOrdered, 'periodStart must not be after periodEnd');

export type CreateDocument = z.input<typeof createDocumentSchema>;

export const updateDocumentSchema = createDocumentFieldsSchema.refine(
  periodIsOrdered,
  'periodStart must not be after periodEnd',
);

export type UpdateDocument = z.input<typeof updateDocumentSchema>;

export const approveDocumentSchema = z.object({
  approved: z.literal(true),
});

const documentListFilterSchemaOf = () =>
  z
    .object({
      docType: documentTypeSchema.optional(),
      person: z.string().trim().min(1).optional(),
      tag: z.string().trim().min(1).optional(),
      text: z.string().trim().min(1).optional(),
      dateFrom: z.iso.date().optional(),
      dateTo: z.iso.date().optional(),
      signatureStatus: documentSignatureStatusSchema.optional(),
      draft: z.enum(['true', 'false', 'all']).optional(),
    })
    .refine(
      (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
      'dateFrom must not be after dateTo',
    );

export const documentListFilterSchema = documentListFilterSchemaOf();

export interface DocumentListFilter {
  docType?: DocumentType | undefined;
  person?: string | undefined;
  tag?: string | undefined;
  text?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  signatureStatus?: DocumentSignatureStatus | undefined;
  draft?: 'true' | 'false' | 'all' | undefined;
}

export const savedSearchFilterSchema = documentListFilterSchemaOf();

export type SavedSearchFilter = DocumentListFilter;

export const savedSearchSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  name: z.string().min(1).max(120),
  filter: savedSearchFilterSchema,
  createdAt: z.iso.datetime(),
});

export interface SavedSearch {
  id: string;
  tenantId: string;
  name: string;
  filter: SavedSearchFilter;
  createdAt: string;
}

export const createSavedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filter: savedSearchFilterSchema,
});

export interface CreateSavedSearch {
  name: string;
  filter: SavedSearchFilter;
}

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

const moveDocumentFileFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(300, 'Title too long'),
  docType: documentTypeSchema,
  documentDate: z.iso.date().optional(),
  periodStart: z.iso.date().nullable().optional(),
  periodEnd: z.iso.date().nullable().optional(),
});

export const moveDocumentFileSchema = moveDocumentFileFieldsSchema.refine(
  periodIsOrdered,
  'periodStart must not be after periodEnd',
);

export type MoveDocumentFile = z.input<typeof moveDocumentFileSchema>;

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
