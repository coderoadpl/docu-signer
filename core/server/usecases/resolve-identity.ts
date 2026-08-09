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
  ApiTokenRepository,
  ApiTokenSecretPort,
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

export interface ResolveApiTokenIdentityDeps extends ResolveIdentityDeps {
  apiTokens: ApiTokenRepository;
  apiTokenSecrets: ApiTokenSecretPort;
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
  return resolveUserIdentity(user, request, deps, null);
};

export const resolveApiTokenIdentity = async (
  tokenValue: string,
  request: TenantRequestInfo,
  deps: ResolveApiTokenIdentityDeps,
): Promise<Result<Identity, AppError>> => {
  const tokenHash = deps.apiTokenSecrets.hash(tokenValue);
  const apiToken = await deps.apiTokens.findActiveByHash(tokenHash);
  if (!apiToken) return err(unauthorized());
  if (!deps.apiTokenSecrets.matchesHash(tokenValue, apiToken.token.tokenHash)) {
    return err(unauthorized());
  }
  await deps.apiTokens.markUsed(apiToken.token.id);
  return resolveUserIdentity(
    apiToken.user,
    request,
    deps,
    { id: apiToken.token.id, scopes: apiToken.token.scopes },
  );
};

const resolveUserIdentity = async (
  user: AuthenticatedUser,
  request: TenantRequestInfo,
  deps: ResolveIdentityDeps,
  apiToken: Identity['apiToken'],
): Promise<Result<Identity, AppError>> => {
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
    apiToken,
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
    apiToken,
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
