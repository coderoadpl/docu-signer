import {
  err,
  grantAdminInputSchema,
  notFound,
  ok,
  revokeAdminInputSchema,
  validation,
  type AppError,
  type GrantAdminInput,
  type Result,
  type StaffMember,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { IdGenerator, StaffRepository, UserDirectory } from '../ports.js';

export interface StaffDeps {
  staff: StaffRepository;
  users: UserDirectory;
  ids: IdGenerator;
}

export interface GrantAdminResult {
  staff: StaffMember;
  /** false when the target already held a grant and was returned unchanged. */
  granted: boolean;
}

export interface RevokeAdminResult {
  userId: string;
  /** Grants removed (1 on success); the tenant-scoped delete makes this the proof. */
  revoked: number;
}

/** Staff-readable roster of a tenant's owner+admin grants (FR-8). */
export const listStaff = async (
  ctx: Ctx,
  deps: StaffDeps,
): Promise<Result<StaffMember[], AppError>> => {
  const scope = authorizeTenant(ctx, 'staff:read');
  if (!scope.ok) return scope;
  return ok(await deps.staff.listByTenant(scope.value));
};

/**
 * Owner grants flat admin access to an EXISTING account by email (FR-8). No
 * invitations (post-MVP): if the email has no global account the grant is refused
 * with `not_found` naming the boundary — the user must register first. Idempotent:
 * a re-grant of a user who already holds any staff grant returns it unchanged
 * (`granted: false`), so it never downgrades an existing owner to admin.
 */
export const grantAdmin = async (
  ctx: Ctx,
  input: GrantAdminInput,
  deps: StaffDeps,
): Promise<Result<GrantAdminResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'staff:grant');
  if (!scope.ok) return scope;

  const parsed = grantAdminInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid admin grant', parsed.error.flatten()));

  const tenantId = scope.value;
  const user = await deps.users.findByEmail(parsed.data.email);
  if (!user) {
    return err(
      notFound(
        `No account for "${parsed.data.email}" — the user must register before being granted admin access (FR-8: no invitations)`,
      ),
    );
  }

  const existing = await deps.staff.findGrant(tenantId, user.userId);
  if (existing) {
    return ok({
      staff: { id: existing.id, userId: user.userId, email: user.email, name: user.name, role: existing.role },
      granted: false,
    });
  }

  const id = deps.ids.nextId();
  await deps.staff.grant({ id, tenantId, userId: user.userId, role: parsed.data.role });
  return ok({
    staff: { id, userId: user.userId, email: user.email, name: user.name, role: parsed.data.role },
    granted: true,
  });
};

/**
 * Owner revokes a staff grant by email or userId (FR-8). Lockout guard: the LAST
 * owner cannot be revoked (whether the caller targets themselves or another) — the
 * tenant must always keep at least one owner, so the attempt is a `validation`
 * error, not a silent no-op. Cross-tenant safety is structural: every repository
 * call is tenant-scoped, so a userId from another tenant reads as `not_found`.
 */
export const revokeAdmin = async (
  ctx: Ctx,
  input: unknown,
  deps: StaffDeps,
): Promise<Result<RevokeAdminResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'staff:revoke');
  if (!scope.ok) return scope;

  const parsed = revokeAdminInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid staff reference', parsed.error.flatten()));

  const tenantId = scope.value;
  const userId = parsed.data.userId ?? (await resolveUserId(parsed.data.email, deps));
  if (userId === null) {
    return err(notFound(`No account for "${parsed.data.email ?? ''}" to revoke`));
  }

  const existing = await deps.staff.findGrant(tenantId, userId);
  if (!existing) return err(notFound('No staff grant for that user in this tenant'));

  // The atomic conditional delete is the authoritative last-owner guard: it
  // removes the grant unless it is the tenant's final owner. A present grant that
  // is not removed can only be that refusal, so map 0 rows → validation (never a
  // silent no-op). The former read-then-check is gone — it could not close the
  // two-concurrent-revokes race the single statement does.
  const revoked = await deps.staff.revokeLastOwnerSafe(tenantId, userId);
  if (revoked === 0) {
    return err(validation('Cannot revoke the last owner of this tenant'));
  }
  return ok({ userId, revoked });
};

const resolveUserId = async (
  email: string | undefined,
  deps: StaffDeps,
): Promise<string | null> => {
  if (email === undefined) return null;
  const user = await deps.users.findByEmail(email);
  return user?.userId ?? null;
};
