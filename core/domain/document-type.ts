import { z } from 'zod';

import { documentTypeSchema } from './document.js';

export const documentTypeLabelSchema = z.string().trim().min(1).max(100);

export const documentTypeDefinitionSchema = z.object({
  slug: documentTypeSchema,
  label: documentTypeLabelSchema,
  position: z.number().int(),
  hidden: z.boolean(),
});

export type DocumentType = z.infer<typeof documentTypeDefinitionSchema>;

export const createDocumentTypeSchema = z.object({
  label: documentTypeLabelSchema,
});

export type CreateDocumentType = z.infer<typeof createDocumentTypeSchema>;

export const renameDocumentTypeSchema = z.object({
  label: documentTypeLabelSchema,
});

export type RenameDocumentType = z.infer<typeof renameDocumentTypeSchema>;

export const setDocumentTypeHiddenSchema = z.object({
  hidden: z.boolean(),
});

export type SetDocumentTypeHidden = z.infer<typeof setDocumentTypeHiddenSchema>;

export const DEFAULT_DOCUMENT_TYPES: readonly DocumentType[] = [
  { slug: 'umowa-uod', label: 'Umowa UoD', position: 10, hidden: false },
  { slug: 'uchwala', label: 'Uchwała', position: 20, hidden: false },
  { slug: 'protokol', label: 'Protokół', position: 30, hidden: false },
  { slug: 'rachunek', label: 'Rachunek', position: 40, hidden: false },
  { slug: 'inny', label: 'Inny', position: 50, hidden: false },
];
