import { z } from 'zod';

export const tenantSettingsSchema = z.object({
  tenantId: z.string().min(1),
  storeSignatureRecords: z.boolean(),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const updateTenantSettingsSchema = z.object({
  storeSignatureRecords: z.boolean(),
});

export type UpdateTenantSettings = z.infer<typeof updateTenantSettingsSchema>;
