import { z } from 'zod';

export const apiTokenScopeSchema = z.enum(['read', 'write', 'write:draft']);

export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

const uniqueScopes = (scopes: readonly ApiTokenScope[]): boolean =>
  new Set(scopes).size === scopes.length;

export const apiTokenScopesSchema = z
  .array(apiTokenScopeSchema)
  .min(1)
  .max(3)
  .refine(uniqueScopes, 'Scopes must not repeat');

export const apiTokenSchema = z.object({
  id: z.uuid(),
  userId: z.string().min(1),
  name: z.string().min(1).max(120),
  scopes: apiTokenScopesSchema,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
}).strict();

export type ApiToken = z.infer<typeof apiTokenSchema>;

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: apiTokenScopesSchema,
});

export type CreateApiToken = z.input<typeof createApiTokenSchema>;
