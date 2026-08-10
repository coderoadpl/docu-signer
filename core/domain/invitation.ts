import { z } from 'zod';

import { staffRoleSchema } from './identity.js';

export const invitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);

export const invitationSchema = z.object({
  id: z.uuid(),
  tenantId: z.string().min(1),
  email: z.email(),
  role: staffRoleSchema,
  invitedBy: z.string().min(1),
  status: invitationStatusSchema,
  expiresAt: z.iso.datetime(),
});

export type Invitation = z.infer<typeof invitationSchema>;

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: staffRoleSchema,
});

export type CreateInvitation = z.input<typeof createInvitationSchema>;

export const acceptInvitationSchema = z.object({
  password: z.string().min(8).max(128),
});

export type AcceptInvitation = z.input<typeof acceptInvitationSchema>;

export const publicInvitationSchema = z.object({
  email: z.email(),
  organizationName: z.string().min(1),
  status: invitationStatusSchema,
});

export type PublicInvitation = z.infer<typeof publicInvitationSchema>;
