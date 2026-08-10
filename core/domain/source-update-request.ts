import { z } from 'zod';

export const sourceUpdateModeSchema = z.enum(['delete-signed', 'transfer']);

export type SourceUpdateMode = z.infer<typeof sourceUpdateModeSchema>;

export const sourceUpdateStatusSchema = z.enum([
  'pending',
  'completed',
  'rejected',
  'cancelled',
]);

export type SourceUpdateStatus = z.infer<typeof sourceUpdateStatusSchema>;

export const sourceUpdateApprovalDecisionSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
]);

export type SourceUpdateApprovalDecision = z.infer<
  typeof sourceUpdateApprovalDecisionSchema
>;

export const sourceUpdateApprovalSchema = z.object({
  id: z.uuid(),
  approverId: z.string().min(1),
  decision: sourceUpdateApprovalDecisionSchema,
});

export type SourceUpdateApproval = z.infer<typeof sourceUpdateApprovalSchema>;

export const sourceUpdateRequestSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  documentId: z.uuid(),
  requestedBy: z.string().min(1),
  newSourceFileId: z.uuid(),
  mode: sourceUpdateModeSchema,
  status: sourceUpdateStatusSchema,
  approvals: z.array(sourceUpdateApprovalSchema),
});

export type SourceUpdateRequest = z.infer<typeof sourceUpdateRequestSchema>;

export const createSourceUpdateRequestSchema = z.object({
  newSourceFileId: z.uuid(),
  mode: sourceUpdateModeSchema,
});

export type CreateSourceUpdateRequest = z.infer<
  typeof createSourceUpdateRequestSchema
>;

export const decideSourceUpdateRequestSchema = z.object({
  decision: z.enum(['accept', 'reject']),
});

export type DecideSourceUpdateRequest = z.infer<
  typeof decideSourceUpdateRequestSchema
>;

export const completeSourceUpdateRequestSchema = z.object({
  signedFileId: z.uuid().optional(),
});

export type CompleteSourceUpdateRequest = z.infer<
  typeof completeSourceUpdateRequestSchema
>;
