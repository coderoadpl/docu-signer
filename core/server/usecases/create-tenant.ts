import {
  appError,
  err,
  ok,
  slugSchema,
  validation,
  type AppError,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, TenantRepository } from '../ports.js';

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
  const denial = authorize(ctx, 'tenant:create');
  if (denial) return err(denial);

  const parsedSlug = slugSchema.safeParse(input.slug);
  if (!parsedSlug.success) {
    return errValidation(parsedSlug.error.issues[0]?.message ?? 'Invalid tenant slug');
  }
  const slug = parsedSlug.data;
  const name = input.name.trim();

  if (name.length === 0) return errValidation('Tenant name is required');

  const existing = await deps.tenants.findBySlug(slug);
  if (existing) return err(appError('conflict', `Tenant "${slug}" already exists`));

  const tenant = await deps.tenants.createTenantWithOwner({
    tenant: { id: deps.ids.nextId(), slug, name, createdAt: deps.clock.nowIso() },
    ownerGrant: { id: deps.ids.nextId(), userId: ctx.identity.userId },
  });

  return ok(tenant);
};

const errValidation = (message: string): Result<Tenant, AppError> => err(validation(message));
