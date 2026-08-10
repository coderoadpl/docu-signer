import { z } from 'zod';

const signatureRecordPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  pressure: z.number().finite().min(0).max(1),
});

const signatureRecordStrokeSchema = z.object({
  points: z.array(signatureRecordPointSchema).min(1),
  simulatePressure: z.boolean().optional(),
});

const signatureRecordPlacementSchema = z.object({
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
  scale: z.number().finite().positive(),
});

const signatureRecordStampSchema = z.object({
  strokes: z.array(signatureRecordStrokeSchema).min(1),
  pageIndex: z.number().int().nonnegative(),
  placement: signatureRecordPlacementSchema,
  inkColor: z.enum(['black', 'navy']),
  inkSize: z.number().finite().positive(),
  contributedBy: z.string().min(1).optional(),
});

export const signatureRecordPayloadSchema = z.array(signatureRecordStampSchema).min(1);

export type SignatureRecordPayload = z.infer<typeof signatureRecordPayloadSchema>;

export const pdfSealMetadataSchema = z.object({
  subject: z.string().min(1),
  declaredAt: z.iso.datetime(),
  appliedAt: z.iso.datetime(),
});

export type PdfSealMetadata = z.infer<typeof pdfSealMetadataSchema>;

const createSignatureRecordPayloadSchema = z
  .array(signatureRecordStampSchema.required({ contributedBy: true }))
  .min(1);

export const signatureRecordSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  documentId: z.uuid(),
  fileId: z.uuid(),
  signedBy: z.string().min(1),
  payload: signatureRecordPayloadSchema,
  seal: pdfSealMetadataSchema.nullable().optional(),
  createdAt: z.iso.datetime(),
});

export type SignatureRecord = z.infer<typeof signatureRecordSchema>;

export const createSignatureRecordSchema = z.object({
  fileId: z.uuid(),
  payload: createSignatureRecordPayloadSchema,
});

export type CreateSignatureRecord = z.infer<typeof createSignatureRecordSchema>;

export const signatureRecordCursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type SignatureRecordCursor = z.infer<typeof signatureRecordCursorSchema>;
