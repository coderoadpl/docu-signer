import {
  err,
  forbidden,
  ok,
  tenantNotFound,
  unauthorized,
  type AppError,
  type Identity,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type {
  AuthenticatedUser,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';

export interface TenantRequestInfo {
  host: string;
  tenantHeader: string | null;
}

export interface ResolveIdentityDeps {
  tenantDomains: TenantDomainRepository;
  tenantAccess: TenantAccessReader;
  tenants: TenantRepository;
  baseDomain: string;
}

const stripPort = (host: string): string => host.split(':')[0] ?? host;
const tenantNotFoundMessage = (slug: string): string =>
  `No tenant "${slug}" or you do not have access to it`;

export const resolveIdentity = async (
  user: AuthenticatedUser | null,
  request: TenantRequestInfo,
  deps: ResolveIdentityDeps,
): Promise<Result<Identity, AppError>> => {
  if (!user) return err(unauthorized());

  const tenant = await resolveTenant(request, deps);
  if (!tenant.ok) return tenant;

  const base: Identity = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    tenantId: null,
    tenantSlug: null,
    tenantName: null,
    staffRole: null,
  };

  if (!tenant.value) return ok(base);

  const staffGrant = await deps.tenantAccess.findStaffGrant(
    user.userId,
    tenant.value.tenant.id,
  );
  if (!staffGrant) {
    return tenant.value.source === 'custom-domain'
      ? err(forbidden('You do not have access to this tenant'))
      : err(tenantNotFound(tenantNotFoundMessage(tenant.value.tenant.slug)));
  }

  return ok({
    ...base,
    tenantId: tenant.value.tenant.id,
    tenantSlug: tenant.value.tenant.slug,
    tenantName: tenant.value.tenant.name,
    staffRole: staffGrant.staffRole,
  });
};

type TenantSource = 'custom-domain' | 'slug';

const resolveTenant = async (
  request: TenantRequestInfo,
  deps: ResolveIdentityDeps,
): Promise<Result<{ tenant: Tenant; source: TenantSource } | null, AppError>> => {
  const host = stripPort(request.host).toLowerCase();
  const customDomain = await deps.tenantDomains.findByDomain(host);
  if (customDomain) {
    const tenant = await deps.tenants.findById(customDomain.tenantId);
    return tenant
      ? ok({ tenant, source: 'custom-domain' })
      : err(tenantNotFound('Tenant domain is not attached'));
  }

  const slug = subdomainOf(host, deps.baseDomain) ?? request.tenantHeader?.toLowerCase() ?? null;
  if (!slug) return ok(null);
  const tenant = await deps.tenants.findBySlug(slug);
  return tenant
    ? ok({ tenant, source: 'slug' })
    : err(tenantNotFound(tenantNotFoundMessage(slug)));
};

const subdomainOf = (host: string, baseDomain: string): string | null => {
  if (host === baseDomain) return null;
  if (!host.endsWith(`.${baseDomain}`)) return null;
  const sub = host.slice(0, -(baseDomain.length + 1));
  return sub.includes('.') ? null : sub;
};
