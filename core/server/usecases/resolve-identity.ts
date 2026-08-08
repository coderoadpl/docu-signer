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
  Clock,
  MemberRepository,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '../ports.js';
import { bindMemberOnSignIn } from './bind-member.js';

export interface TenantRequestInfo {
  /** Host header, may include a port. */
  host: string;
  /** Value of the X-Tenant header, if any. */
  tenantHeader: string | null;
}

export interface ResolveIdentityDeps {
  tenantDomains: TenantDomainRepository;
  tenantAccess: TenantAccessReader;
  tenants: TenantRepository;
  members: MemberRepository;
  clock: Clock;
  /** e.g. "localhost" in dev, "agentproofarch.com" in prod. */
  baseDomain: string;
}

const stripPort = (host: string): string => host.split(':')[0] ?? host;
const tenantNotFoundMessage = (slug: string): string =>
  `No tenant "${slug}" or you do not have access to it`;

/**
 * Tenant resolution order (PRD §3.4):
 *  1. exact custom-domain match in tenant_domains,
 *  2. subdomain of the base domain (subdomain = tenant slug),
 *  3. X-Tenant header (CLI and other non-browser clients on the base domain).
 * A request on the bare base domain with no header yields a tenant-less identity.
 */
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
    memberId: null,
  };

  if (!tenant.value) return ok(base);

  const staffGrant = await deps.tenantAccess.findStaffGrant(user.userId, { tenantId: tenant.value.tenant.id });
  // US-026: a member provisioned with a null userId is claimed on this first
  // authenticated resolution (magic link, social, any method), so an
  // already-bound account short-circuits before the bind read.
  const member =
    (await deps.tenantAccess.findMember(user.userId, tenant.value.tenant.id)) ??
    (await bindMemberOnSignIn(
      { tenantId: tenant.value.tenant.id, userId: user.userId, email: user.email },
      deps,
    ));

  if (!staffGrant && !member) {
    return tenant.value.source === 'custom-domain'
      ? err(forbidden('You do not have access to this tenant'))
      : err(tenantNotFound(tenantNotFoundMessage(tenant.value.tenant.slug)));
  }

  return ok({
    ...base,
    tenantId: tenant.value.tenant.id,
    tenantSlug: tenant.value.tenant.slug,
    tenantName: tenant.value.tenant.name,
    staffRole: staffGrant?.staffRole ?? null,
    memberId: member?.id ?? null,
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
    return tenant ? ok({ tenant, source: 'custom-domain' }) : err(tenantNotFound('Tenant domain is not attached'));
  }

  const slug = subdomainOf(host, deps.baseDomain) ?? request.tenantHeader?.toLowerCase() ?? null;
  if (!slug) return ok(null);

  const tenant = await deps.tenants.findBySlug(slug);
  return tenant ? ok({ tenant, source: 'slug' }) : err(tenantNotFound(tenantNotFoundMessage(slug)));
};

const subdomainOf = (host: string, baseDomain: string): string | null => {
  if (host === baseDomain) return null;
  if (!host.endsWith(`.${baseDomain}`)) return null;
  const sub = host.slice(0, -(baseDomain.length + 1));
  // Nested subdomains (a.b.localhost) are not tenant slugs.
  if (sub.includes('.')) return null;
  return sub;
};
