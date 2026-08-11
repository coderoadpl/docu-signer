import { ok, type AppError, type Result, type TenantAccount } from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { TenantAccountRepository } from '../ports.js';

export interface TenantAccountDeps {
  tenantAccounts: TenantAccountRepository;
}

export const listTenantAccounts = async (
  ctx: Ctx,
  deps: TenantAccountDeps,
): Promise<Result<TenantAccount[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  return ok(await deps.tenantAccounts.listByTenant(scope.value));
};
