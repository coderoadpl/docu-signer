import {
  err,
  hiddenFilterValueRefSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type HiddenFilterValue,
  type HiddenFilterValueRef,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { HiddenFilterValueRepository, IdGenerator } from '../ports.js';

export interface HiddenFilterValueDeps {
  hiddenFilterValues: HiddenFilterValueRepository;
  ids: IdGenerator;
}

export const listHiddenFilterValues = async (
  ctx: Ctx,
  deps: HiddenFilterValueDeps,
): Promise<Result<HiddenFilterValue[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  return ok(await deps.hiddenFilterValues.listByTenant(scope.value));
};

export const hideFilterValue = async (
  ctx: Ctx,
  input: HiddenFilterValueRef,
  deps: HiddenFilterValueDeps,
): Promise<Result<HiddenFilterValue, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsed = hiddenFilterValueRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid filter value', parsed.error.flatten()));
  return ok(
    await deps.hiddenFilterValues.hide({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      ...parsed.data,
    }),
  );
};

export const unhideFilterValue = async (
  ctx: Ctx,
  input: HiddenFilterValueRef,
  deps: HiddenFilterValueDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'tenant-settings:manage');
  if (!scope.ok) return scope;
  const parsed = hiddenFilterValueRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid filter value', parsed.error.flatten()));
  const unhidden = await deps.hiddenFilterValues.unhide(
    scope.value,
    parsed.data.kind,
    parsed.data.value,
  );
  return unhidden ? ok(undefined) : err(notFound('Hidden filter value not found'));
};
