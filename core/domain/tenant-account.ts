import { z } from 'zod';

export const tenantAccountSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
});

export type TenantAccount = z.infer<typeof tenantAccountSchema>;
