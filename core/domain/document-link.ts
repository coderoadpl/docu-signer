import { z } from 'zod';

import { documentSchema } from './document.js';

export const DOCUMENT_LINK_LABEL_MAX_LENGTH = 60;

export const documentLinkLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(DOCUMENT_LINK_LABEL_MAX_LENGTH);

export const linkDocumentsInputSchema = z.object({
  otherDocumentId: z.uuid(),
  label: documentLinkLabelSchema.nullable().optional(),
});

export type LinkDocumentsInput = z.input<typeof linkDocumentsInputSchema>;

export const documentLinkSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  fromDocumentId: z.uuid(),
  toDocumentId: z.uuid(),
  label: documentLinkLabelSchema.nullable(),
});

export type DocumentLink = z.infer<typeof documentLinkSchema>;

export const linkedDocumentSchema = z.object({
  linkId: z.uuid(),
  label: documentLinkLabelSchema.nullable(),
  document: documentSchema,
});

export type LinkedDocument = z.infer<typeof linkedDocumentSchema>;
