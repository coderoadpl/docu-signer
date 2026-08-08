import {
  appError,
  domainAddInputSchema,
  domainCheckInputSchema,
  domainRemoveInputSchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type Result,
  type TenantDomain,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { DomainCheck, DomainPort, IdGenerator, TenantDomainRepository } from '../ports.js';

/** The deploy-wide public target tenants point a custom domain at (env-driven). */
export interface DomainTarget {
  cname: string | null;
  ip: string | null;
}

export interface DomainDeps {
  tenantDomains: TenantDomainRepository;
  domainPort: DomainPort;
  ids: IdGenerator;
  domainTarget: DomainTarget;
}

export interface CheckDomainResult {
  domain: TenantDomain;
  check: DomainCheck;
}

export interface RemoveDomainResult {
  domain: string;
  /** Rows deleted (1 on success); the tenant-scoped delete makes this the proof. */
  removed: number;
}

/** Staff-readable roster of a tenant's attached custom domains (US-019). */
export const listDomains = async (
  ctx: Ctx,
  deps: DomainDeps,
): Promise<Result<TenantDomain[], AppError>> => {
  const scope = authorizeTenant(ctx, 'domain:read');
  if (!scope.ok) return scope;
  return ok(await deps.tenantDomains.listByTenant(scope.value));
};

/**
 * Owner attaches a custom domain (US-019, `domain:write`). A host attaches to at
 * most one tenant, so a domain already attached anywhere is a `conflict`. The
 * provisioner is asked to provision first (a no-op for caddy/noop, the Vercel API
 * call for US-020), then the row is written UNVERIFIED — verification is the
 * separate `checkDomain` step once the tenant has pointed DNS.
 */
export const addDomain = async (
  ctx: Ctx,
  input: unknown,
  deps: DomainDeps,
): Promise<Result<TenantDomain, AppError>> => {
  const scope = authorizeTenant(ctx, 'domain:write');
  if (!scope.ok) return scope;

  const parsed = domainAddInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid domain', parsed.error.flatten()));
  const { domain } = parsed.data;

  const conflict = await deps.tenantDomains.findAnyByDomain(domain);
  if (conflict) return err(appError('conflict', `Domain "${domain}" is already attached`));

  await deps.domainPort.provision(domain);
  const row = await deps.tenantDomains.add({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    domain,
    kind: 'custom',
    verified: false,
  });
  return ok(row);
};

/**
 * Owner re-checks a domain (US-019, `domain:write`): ask the provisioner whether
 * DNS points at this deploy and persist the resulting verified flag, so the
 * roster reflects the live state. `not_found` when the domain is not this
 * tenant's (cross-tenant safety is structural — the lookup is tenant-scoped).
 */
export const checkDomain = async (
  ctx: Ctx,
  input: unknown,
  deps: DomainDeps,
): Promise<Result<CheckDomainResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'domain:write');
  if (!scope.ok) return scope;

  const parsed = domainCheckInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid domain', parsed.error.flatten()));
  const { domain } = parsed.data;

  const existing = await deps.tenantDomains.findByTenantAndDomain(scope.value, domain);
  if (!existing) return err(notFound(`No domain "${domain}" attached to this tenant`));

  const check = await deps.domainPort.check(domain);
  const updated = await deps.tenantDomains.setVerified(scope.value, domain, check.resolved);
  return ok({ domain: updated ?? { ...existing, verified: check.resolved }, check });
};

/**
 * Owner detaches a domain (US-019, `domain:write`). The provisioner is asked to
 * release it after the row is removed; a zero row count (the domain was not this
 * tenant's) is a `not_found`, never a silent success.
 */
export const removeDomain = async (
  ctx: Ctx,
  input: unknown,
  deps: DomainDeps,
): Promise<Result<RemoveDomainResult, AppError>> => {
  const scope = authorizeTenant(ctx, 'domain:write');
  if (!scope.ok) return scope;

  const parsed = domainRemoveInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid domain', parsed.error.flatten()));
  const { domain } = parsed.data;

  const removed = await deps.tenantDomains.removeByTenantAndDomain(scope.value, domain);
  if (removed === 0) return err(notFound(`No domain "${domain}" attached to this tenant`));

  await deps.domainPort.remove(domain);
  return ok({ domain, removed });
};
