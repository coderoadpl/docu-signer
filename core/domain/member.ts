import { z } from 'zod';

/**
 * The end-customer ("member") aggregate — a tenant-scoped profile owned entirely
 * by the tenant, never by the global auth account (PRD §3.4, ADR-0002). The row
 * owns its own email snapshot so export and marketing never join to the auth
 * provider. `userId` is nullable: `ensureMember` can provision a member row from
 * product code (e.g. a payment webhook) before any auth account exists — the
 * passwordless account + magic-link binding that fills `userId` is US-026, a
 * separate story. Concurrency stance: last-write-wins (short-lived per-tenant
 * rows; a lost profile edit costs a re-type, per §Data conventions).
 */

export const marketingChannelSchema = z.enum(['email', 'sms', 'postal']);

export type MarketingChannel = z.infer<typeof marketingChannelSchema>;

/** A per-tenant marketing consent record; `updatedAt` is server-stamped. */
export const marketingConsentSchema = z.object({
  channel: marketingChannelSchema,
  granted: z.boolean(),
  updatedAt: z.string(),
});

export type MarketingConsent = z.infer<typeof marketingConsentSchema>;

const displayNameSchema = z.string().trim().min(1).max(200);
const tagsSchema = z.array(z.string().trim().min(1).max(64)).max(50);
const externalCustomerIdsSchema = z.array(z.string().trim().min(1).max(128)).max(50);

/** Client-supplied consent: the server stamps `updatedAt` at write time. */
export const marketingConsentInputSchema = z.object({
  channel: marketingChannelSchema,
  granted: z.boolean(),
});

const marketingConsentInputsSchema = z.array(marketingConsentInputSchema).max(20);

/** Normalized at the boundary so tenant+email idempotency is case-insensitive. */
export const memberEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const memberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  userId: z.string().nullable(),
  email: z.string(),
  displayName: z.string().nullable(),
  tags: tagsSchema,
  marketingConsents: z.array(marketingConsentSchema),
  externalCustomerIds: externalCustomerIdsSchema,
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});

export type Member = z.infer<typeof memberSchema>;

/** `ensureMember` input — the idempotent find-or-create entry point (FR-20). */
export const newMemberSchema = z.object({
  email: memberEmailSchema,
  displayName: displayNameSchema.optional(),
  tags: tagsSchema.optional(),
  marketingConsents: marketingConsentInputsSchema.optional(),
  externalCustomerIds: externalCustomerIdsSchema.optional(),
});

export type NewMember = z.infer<typeof newMemberSchema>;

/** `updateMember` input — a present key sets the field; `displayName: null` clears it. */
export const memberUpdateSchema = z.object({
  id: z.string().min(1),
  displayName: z.union([displayNameSchema, z.null()]).optional(),
  tags: tagsSchema.optional(),
  marketingConsents: marketingConsentInputsSchema.optional(),
});

export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

export const memberRefSchema = z.object({ id: z.string().min(1) });

export type MemberRef = z.infer<typeof memberRefSchema>;

/**
 * A GDPR access/portability dump for one member (ADR-0002: member-level export
 * is a foundation capability). The email is read from the member row's own
 * snapshot — never a live join to the auth provider — so the export is complete
 * and provider-independent. This is the member-level shape the tenant-wide
 * `exportTenantData` (§Data lifecycle, deferred) will iterate.
 */
export const memberExportSchema = z.object({
  exportedAt: z.string(),
  tenantId: z.string(),
  member: memberSchema,
});

export type MemberExport = z.infer<typeof memberExportSchema>;
