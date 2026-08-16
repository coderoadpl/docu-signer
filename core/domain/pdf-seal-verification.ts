import { z } from 'zod';

export const pdfSealVerificationSchema = z.object({
  subject: z.string().min(1),
  name: z.string().nullable(),
  reason: z.string().nullable(),
  declaredAt: z.iso.datetime(),
  byteRangeValid: z.boolean(),
  digestValid: z.boolean(),
  signatureValid: z.boolean(),
  integrity: z.boolean(),
});

export type PdfSealVerification = z.infer<typeof pdfSealVerificationSchema>;
