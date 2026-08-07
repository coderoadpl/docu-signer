import { ok, type AppError, type Membership, type Result } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantAccessReader } from '../ports.js';

export const listMyTenants = async (
  ctx: Ctx,
  deps: { tenantAccess: TenantAccessReader },
): Promise<Result<Membership[], AppError>> => ok(await deps.tenantAccess.listTenantsForStaff(ctx.identity.userId));
