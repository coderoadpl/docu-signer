import { ok, type AppError, type Membership, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantAccessReader } from '../ports.js';

/**
 * Self-scoped read: enumerates only the caller's own staff memberships, so
 * authentication is the control — there is no capability to check (§Authorization).
 */
export const listMyTenants = async (
  ctx: Ctx,
  deps: { tenantAccess: TenantAccessReader },
): Promise<Result<Membership[], AppError>> => ok(await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId));
