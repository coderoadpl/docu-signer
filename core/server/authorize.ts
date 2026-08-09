import {
  decide,
  err,
  forbidden,
  ok,
  tenantNotFound,
  type AppError,
  type Capability,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from './context.js';

/**
 * The authorization predicate every use-case runs before touching a repository.
 * Naming a `capability` is required, so a new use-case cannot compile without
 * declaring what it guards (the type-level nudge). What is NOT type-forced: a
 * use-case that never calls this helper at all still compiles — the predicate is
 * a discipline the tests and review enforce, not the compiler.
 */
export const authorize = (ctx: Ctx, capability: Capability): AppError | null => {
  const verdict = decide(ctx.identity, capability);
  return verdict.allowed ? null : forbidden(verdict.reason);
};

/**
 * Tenant-scoped variant: authorize, then hand back the resolved `tenantId` so
 * repository calls narrow to a non-null tenant without a second guard. A denied
 * principal (including the tenant-less visitor, denied every tenant-scoped
 * capability) returns `forbidden`; an allowed-but-tenant-less identity — a role
 * carried without a resolved tenant, which real resolution never produces — is
 * refused with `tenant_not_found` rather than queried against a null tenant.
 */
export const authorizeTenant = (ctx: Ctx, capability: Capability): Result<string, AppError> => {
  const denial = authorize(ctx, capability);
  if (denial) return err(denial);
  return ctx.identity.tenantId === null
    ? err(tenantNotFound('Select a tenant'))
    : ok(ctx.identity.tenantId);
};
