import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

/**
 * The tenant-staff aggregate surfaced to clients (FR-8): one `tenant_admins` row
 * joined to its global account for the human-readable email/name. Staff are our
 * own foundation grants (`owner | admin`), never an auth-provider org member; the
 * email/name are read from the account only for display — the grant itself keys
 * on the opaque `userId`. `id` is the grant row id (stable revoke handle).
 */
export const staffMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: staffRoleSchema,
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

/** Normalized at the boundary so a grant/revoke matches the account case-insensitively. */
export const staffEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

/**
 * `grantAdmin` input (FR-8, owner-only). `role` is fixed to `admin`: an owner is
 * only ever minted by tenant creation (`createTenant` writes the owner row), so
 * this grant surface deliberately cannot manufacture a second owner. Defaulting
 * to `admin` keeps `staff grant <email>` a one-argument command while the literal
 * makes any other role a compile/parse error.
 */
export const grantAdminInputSchema = z.object({
  email: staffEmailSchema,
  role: z.literal('admin').default('admin'),
});

export type GrantAdminInput = z.input<typeof grantAdminInputSchema>;

/**
 * `revokeAdmin` input (FR-8, owner-only): target a staff grant by `email` OR by
 * opaque `userId`, exactly one. `userId` is the durable handle (an account can
 * change its email); `email` is the ergonomic one the CLI/web offer.
 */
export const revokeAdminInputSchema = z
  .object({
    userId: z.string().trim().min(1).optional(),
    email: staffEmailSchema.optional(),
  })
  .refine(
    (value) => (value.userId === undefined) !== (value.email === undefined),
    { message: 'Provide exactly one of userId or email' },
  );

export type RevokeAdminInput = z.input<typeof revokeAdminInputSchema>;
