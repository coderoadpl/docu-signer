import type { Member } from '#core/domain/index.js';

import type { Clock, MemberRepository } from '../ports.js';

export interface BindMemberDeps {
  members: MemberRepository;
  clock: Clock;
}

export interface BindMemberInput {
  tenantId: string;
  userId: string;
  email: string;
}

/**
 * US-026 member↔user binding. A member provisioned by `ensureMember` (a payment
 * webhook, staff) has a null `userId` until they first authenticate — via magic
 * link, social, or any method — into the tenant. This is the trigger: on the
 * first authenticated resolution where no member is yet bound to this account,
 * the (tenant, email) member row is claimed by binding its `userId` and stamping
 * `lastSeenAt`. It carries no capability — like tenant resolution itself, it is a
 * system step gated by an established session, not a tenant-staff action.
 *
 * Idempotent and safe: once bound, `findMember(userId)` upstream finds the row so
 * this never runs again for that account; a member already bound to a DIFFERENT
 * account is left untouched and NOT granted (returns null), so an email collision
 * can never hand one user another's provisioned membership.
 */
export const bindMemberOnSignIn = async (
  input: BindMemberInput,
  deps: BindMemberDeps,
): Promise<Member | null> => {
  const member = await deps.members.findByEmail(input.tenantId, input.email);
  if (!member || member.userId !== null) return null;
  const bound: Member = { ...member, userId: input.userId, lastSeenAt: deps.clock.nowIso() };
  await deps.members.update(bound);
  return bound;
};
