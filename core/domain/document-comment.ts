import { z } from 'zod';

import { tenantAccountSchema } from './tenant-account.js';

const MAX_DOCUMENT_COMMENT_BODY_LENGTH = 2000;

export const documentCommentSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  documentId: z.uuid(),
  authorAccountId: z.string().min(1),
  body: z.string().trim().min(1).max(MAX_DOCUMENT_COMMENT_BODY_LENGTH),
  draft: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});

export type DocumentComment = z.infer<typeof documentCommentSchema>;

export const documentCommentListItemSchema = documentCommentSchema
  .omit({ authorAccountId: true })
  .extend({ author: tenantAccountSchema });

export type DocumentCommentListItem = z.infer<typeof documentCommentListItemSchema>;

export const createDocumentCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Comment must not be empty')
    .max(MAX_DOCUMENT_COMMENT_BODY_LENGTH, 'Comment is too long'),
});

export type CreateDocumentComment = z.input<typeof createDocumentCommentSchema>;

export const documentCommentCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type DocumentCommentCursor = z.infer<typeof documentCommentCursorSchema>;
