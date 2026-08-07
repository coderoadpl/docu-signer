import {
  appError,
  err,
  ok,
  validation,
  type AppError,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, TenantRepository } from '../ports.js';

const slugPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export interface CreateTenantDeps {
  tenants: TenantRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const createTenant = async (
  ctx: Ctx,
  input: { slug: string; name: string },
  deps: CreateTenantDeps,
): Promise<Result<Tenant, AppError>> => {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();

  if (!slugPattern.test(slug)) return errValidation('Tenant slug must be 3-63 lowercase letters, numbers or hyphens');
  if (name.length === 0) return errValidation('Tenant name is required');

  const existing = await deps.tenants.findBySlug(slug);
  if (existing) return err(appError('conflict', `Tenant "${slug}" already exists`));

  const tenant = await deps.tenants.createTenant({
    id: deps.ids.nextId(),
    slug,
    name,
    createdAt: deps.clock.nowIso(),
  });

  await deps.tenants.createOwnerGrant({
    id: deps.ids.nextId(),
    tenantId: tenant.id,
    userId: ctx.identity.userId,
    staffRole: 'owner',
  });

  return ok(tenant);
};

const errValidation = (message: string): Result<Tenant, AppError> => err(validation(message));
