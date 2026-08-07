import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

export const tenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

export type Tenant = z.infer<typeof tenantSchema>;

export const membershipSchema = z.object({
  tenant: tenantSchema,
  staffRole: staffRoleSchema,
});

export type Membership = z.infer<typeof membershipSchema>;

export const memberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.string(),
});

export type Member = z.infer<typeof memberSchema>;

export const tenantDomainSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  domain: z.string(),
  kind: z.enum(['subdomain', 'custom']),
  verified: z.boolean(),
});

export type TenantDomain = z.infer<typeof tenantDomainSchema>;
