import {
  err,
  memberRefSchema,
  memberUpdateSchema,
  newMemberSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type Member,
  type MemberExport,
  type MemberUpdate,
  type NewMember,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, MemberRepository } from '../ports.js';

export interface MemberDeps {
  members: MemberRepository;
  ids: IdGenerator;
  clock: Clock;
}

export interface EnsureMemberResult {
  member: Member;
  /** false when an existing member for (tenant, email) was returned unchanged. */
  created: boolean;
}

export interface RemoveMemberResult {
  memberId: string;
  /**
   * Rows removed per member-owned aggregate — the removal cascade, made
   * observable. Today the member row is the ONLY tenant-scoped data keyed by the
   * member (todos/cards are authored by `userId`, not `memberId`), so the map has
   * one key; product aggregates keyed by `memberId` (progress, orders) add their
   * own counts here as they land, alongside their FK cascade.
   */
  deleted: { members: number };
}

export const listMembers = async (
  ctx: Ctx,
  deps: MemberDeps,
): Promise<Result<Member[], AppError>> => {
  const scope = authorizeTenant(ctx, 'member:read');
  if (!scope.ok) return scope;
  return ok(await deps.members.listByTenant(scope.value));
};

/**
 * The PRD's entry point (FR-20): idempotent find-or-create by (tenant, email).
 * Product code (a payment webhook) can call it repeatedly; an existing member is
 * returned unchanged (`created: false`) so a re-fire never clobbers a
 * staff-curated profile — profile edits go through `updateMember`. The created
 * row's `userId` is null: binding a passwordless auth account is US-026.
 */
export const ensureMember = async (
  ctx: Ctx,
  input: NewMember,
  deps: MemberDeps,
): Promise<Result<EnsureMemberResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'member:write');
  if (!scope.ok) return scope;

  const parsed = newMemberSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid member', parsed.error.flatten()));

  const tenantId = scope.value;
  const existing = await deps.members.findByEmail(tenantId, parsed.data.email);
  if (existing) return ok({ member: existing, created: false });

  const now = deps.clock.nowIso();
  const member: Member = {
    id: deps.ids.nextId(),
    tenantId,
    userId: null,
    email: parsed.data.email,
    displayName: parsed.data.displayName ?? null,
    tags: parsed.data.tags ?? [],
    marketingConsents: (parsed.data.marketingConsents ?? []).map((consent) => ({
      ...consent,
      updatedAt: now,
    })),
    externalCustomerIds: parsed.data.externalCustomerIds ?? [],
    createdAt: now,
    lastSeenAt: null,
  };
  await deps.members.create(member);
  return ok({ member, created: true });
};

export const updateMember = async (
  ctx: Ctx,
  input: MemberUpdate,
  deps: MemberDeps,
): Promise<Result<Member, AppError>> => {
  const scope = authorizeTenant(ctx, 'member:write');
  if (!scope.ok) return scope;

  const parsed = memberUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid member update', parsed.error.flatten()));

  const existing = await deps.members.findByTenantAndId(scope.value, parsed.data.id);
  if (!existing) return err(notFound(`No member "${parsed.data.id}" in this tenant`));

  const now = deps.clock.nowIso();
  const updated: Member = {
    ...existing,
    displayName: 'displayName' in parsed.data ? parsed.data.displayName ?? null : existing.displayName,
    tags: parsed.data.tags ?? existing.tags,
    marketingConsents: parsed.data.marketingConsents
      ? parsed.data.marketingConsents.map((consent) => ({ ...consent, updatedAt: now }))
      : existing.marketingConsents,
  };
  await deps.members.update(updated);
  return ok(updated);
};

/**
 * Creator removes a member from THEIR tenant (ADR-0002 operation 1): delete the
 * member row and every tenant-scoped aggregate keyed by that member. The global
 * account is untouched (it may belong to other tenants). Cross-tenant safety is
 * structural: `findByTenantAndId`/`deleteByTenantAndId` are tenant-scoped, so a
 * member id from another tenant reads as `not_found`, never a cross-tenant delete.
 */
export const removeMember = async (
  ctx: Ctx,
  input: unknown,
  deps: MemberDeps,
): Promise<Result<RemoveMemberResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'member:remove');
  if (!scope.ok) return scope;

  const parsed = memberRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid member reference', parsed.error.flatten()));

  const existing = await deps.members.findByTenantAndId(scope.value, parsed.data.id);
  if (!existing) return err(notFound(`No member "${parsed.data.id}" in this tenant`));

  const removed = await deps.members.deleteByTenantAndId(scope.value, parsed.data.id);
  return ok({ memberId: parsed.data.id, deleted: { members: removed } });
};

export const exportMember = async (
  ctx: Ctx,
  input: unknown,
  deps: MemberDeps,
): Promise<Result<MemberExport, AppError>> => {
  const scope = authorizeTenant(ctx, 'member:export');
  if (!scope.ok) return scope;

  const parsed = memberRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid member reference', parsed.error.flatten()));

  const existing = await deps.members.findByTenantAndId(scope.value, parsed.data.id);
  if (!existing) return err(notFound(`No member "${parsed.data.id}" in this tenant`));

  return ok({ exportedAt: deps.clock.nowIso(), tenantId: scope.value, member: existing });
};
