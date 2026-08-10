import { z } from 'zod';

export const tenantDateModeSchema = z.enum(['declared', 'actual']);

export type TenantDateMode = z.infer<typeof tenantDateModeSchema>;

export const tenantSettingsSchema = z.object({
  tenantId: z.string().min(1),
  storeSignatureRecords: z.boolean(),
  pdfSealEnabled: z.boolean(),
  dateMode: tenantDateModeSchema,
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const updateTenantSettingsSchema = z.object({
  storeSignatureRecords: z.boolean().optional(),
  pdfSealEnabled: z.boolean().optional(),
  dateMode: tenantDateModeSchema.optional(),
}).refine(
  (settings) => Object.values(settings).some((value) => value !== undefined),
  'At least one tenant setting is required',
);

export type UpdateTenantSettings = z.infer<typeof updateTenantSettingsSchema>;

export const signingDocumentDate = (
  dateMode: TenantDateMode,
  documentDate: string,
  now: Date,
): string =>
  dateMode === 'actual' && documentDate.length === 0
    ? now.toISOString().slice(0, 10)
    : documentDate;
