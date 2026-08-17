import { z } from 'zod';

import { documentTypeSchema } from './document.js';
import { tenantAccountSchema } from './tenant-account.js';

const metadataChangesShape = {
  title: z.string().trim().min(1, 'Title must not be empty').max(300, 'Title too long'),
  docType: documentTypeSchema,
  documentDate: z.iso.date(),
  periodStart: z.iso.date().nullable(),
  periodEnd: z.iso.date().nullable(),
  person: z.string().trim().min(1).nullable(),
  tags: z.array(z.string().trim().min(1)),
};

export const documentMetadataChangesSchema = z
  .object({
    title: metadataChangesShape.title.optional(),
    docType: metadataChangesShape.docType.optional(),
    documentDate: metadataChangesShape.documentDate.optional(),
    periodStart: metadataChangesShape.periodStart.optional(),
    periodEnd: metadataChangesShape.periodEnd.optional(),
    person: metadataChangesShape.person.optional(),
    tags: metadataChangesShape.tags.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one metadata change is required')
  .refine(
    (value) =>
      value.periodStart === undefined ||
      value.periodEnd === undefined ||
      value.periodStart === null ||
      value.periodEnd === null ||
      value.periodStart <= value.periodEnd,
    'periodStart must not be after periodEnd',
  );

export type DocumentMetadataChanges = z.infer<typeof documentMetadataChangesSchema>;

export const documentMetadataProposalSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  documentId: z.uuid(),
  changes: documentMetadataChangesSchema,
  creatorAccountId: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type DocumentMetadataProposal = z.infer<typeof documentMetadataProposalSchema>;

export const documentMetadataProposalListItemSchema = documentMetadataProposalSchema
  .omit({ creatorAccountId: true })
  .extend({ creator: tenantAccountSchema });

export type DocumentMetadataProposalListItem = z.infer<
  typeof documentMetadataProposalListItemSchema
>;

export const documentMetadataProposalCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type DocumentMetadataProposalCursor = z.infer<
  typeof documentMetadataProposalCursorSchema
>;

