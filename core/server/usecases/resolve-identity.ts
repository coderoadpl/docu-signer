import {
  err,
  ok,
  tenantNotFound,
  unauthorized,
  type AppError,
  type Identity,
  type Result,
} from '#core/domain/index.js';

import type { AuthenticatedUser, TenantAccessReader, TenantRepository } from '../ports.js';

export interface TenantRequestInfo {
  host: string;
  tenantHeader: string | null;
}

export interface ResolveIdentityDeps {
  tenantAccess: TenantAccessReader;
  tenants: TenantRepository;
}

export const resolveIdentity = async (
  user: AuthenticatedUser | null,
  _request: TenantRequestInfo,
  deps: ResolveIdentityDeps,
): Promise<Result<Identity, AppError>> => {
  if (!user) return err(unauthorized());
  const tenant = await deps.tenants.findBySlug('default');
  if (!tenant) return err(tenantNotFound('Default tenant is not configured'));
  const staffGrant = await deps.tenantAccess.findStaffGrant(user.userId, { tenantId: tenant.id });
  const member = await deps.tenantAccess.findMember(user.userId, tenant.id);
  return ok({
    userId: user.userId,
    email: user.email,
    name: user.name,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    staffRole: staffGrant?.staffRole ?? null,
    memberId: member?.id ?? null,
  });
};
