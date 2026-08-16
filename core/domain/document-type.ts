import { z } from 'zod';

import { documentTypeSchema } from './document.js';

export const documentTypeLabelSchema = z.string().trim().min(1).max(100);

export const documentTypeDefinitionSchema = z.object({
  slug: documentTypeSchema,
  label: documentTypeLabelSchema,
  position: z.number().int(),
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

export const DEFAULT_DOCUMENT_TYPES: readonly DocumentType[] = [
  { slug: 'umowa-uod', label: 'Umowa UoD', position: 10 },
  { slug: 'uchwala', label: 'Uchwała', position: 20 },
  { slug: 'protokol', label: 'Protokół', position: 30 },
  { slug: 'rachunek', label: 'Rachunek', position: 40 },
  { slug: 'inny', label: 'Inny', position: 50 },
];
