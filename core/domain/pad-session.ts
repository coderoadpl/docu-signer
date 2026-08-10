import { z } from 'zod';

export const MAX_PAD_STROKES_BYTES = 4 * 1024 * 1024;
export const PAD_STROKES_TOO_LARGE_MESSAGE =
  'Podpis jest zbyt duży — spróbuj krótszymi pociągnięciami.';
export const PAD_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const padSessionStatusSchema = z.enum(['active', 'closed']);

const padInkColorIdSchema = z.enum(['black', 'navy']);

const padInkPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  pressure: z.number().finite().min(0).max(1),
});

const padInkStrokeSchema = z.object({
  points: z.array(padInkPointSchema).min(1),
  simulatePressure: z.boolean().optional(),
});

const padSignatureRequestSchema = z.object({
  requestId: z.uuid(),
  documentTitle: z.string().trim().min(1).max(300),
});

export type PadSignatureRequest = z.infer<typeof padSignatureRequestSchema>;

const padSurfaceSizeSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const serializedSize = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const padSubmittedStrokesSchema = z
  .object({
    requestId: z.uuid(),
    strokes: z.array(padInkStrokeSchema).min(1),
    inkColor: padInkColorIdSchema,
    sourceSize: padSurfaceSizeSchema,
  })
  .refine(
    (value) => serializedSize(value) <= MAX_PAD_STROKES_BYTES,
    PAD_STROKES_TOO_LARGE_MESSAGE,
  );

export type PadSubmittedStrokes = z.infer<typeof padSubmittedStrokesSchema>;

export const padSessionSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  createdBy: z.string().min(1),
  secretHash: z.string().min(1),
  status: padSessionStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastPolledAt: z.iso.datetime().nullable(),
  currentRequest: padSignatureRequestSchema.nullable(),
  submittedStrokes: padSubmittedStrokesSchema.nullable(),
});

export type PadSession = z.infer<typeof padSessionSchema>;

export const padSessionCreateOutputSchema = z.object({
  session: padSessionSchema.omit({ secretHash: true, submittedStrokes: true }),
  secret: z.string().min(1),
});

export const padSessionActiveOutputSchema = z.object({
  session: padSessionSchema.omit({ secretHash: true, submittedStrokes: true }).nullable(),
});

export const padSessionJoinOutputSchema = z.object({
  session: padSessionSchema.omit({ secretHash: true, submittedStrokes: true }),
});

export const padSessionStateOutputSchema = z.object({
  status: padSessionStatusSchema,
  currentRequest: padSignatureRequestSchema.nullable(),
});

export const padSessionRequestInputSchema = z.object({
  documentTitle: z.string().trim().min(1).max(300),
});

export const padSessionRequestOutputSchema = z.object({
  request: padSignatureRequestSchema,
});

export const padSessionConsumeOutputSchema = z.object({
  submittedStrokes: padSubmittedStrokesSchema.nullable(),
  lastPolledAt: z.iso.datetime().nullable(),
});
