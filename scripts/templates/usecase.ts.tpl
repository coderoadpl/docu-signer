import {
  err,
  new__SINGULAR_PASCAL__Schema,
  ok,
  validation,
  type AppError,
  type New__SINGULAR_PASCAL__,
  type Result,
  type __SINGULAR_PASCAL__,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, __SINGULAR_PASCAL__Repository } from '../ports.js';

export interface __SINGULAR_PASCAL__Deps {
  __PLURAL_CAMEL__: __SINGULAR_PASCAL__Repository;
  ids: IdGenerator;
  clock: Clock;
}

export const list__PLURAL_PASCAL__ = async (
  ctx: Ctx,
  deps: __SINGULAR_PASCAL__Deps,
): Promise<Result<__SINGULAR_PASCAL__[], AppError>> => {
  const scope = authorizeTenant(ctx, '__SINGULAR_KEBAB__:read');
  if (!scope.ok) return scope;
  return ok(await deps.__PLURAL_CAMEL__.listByTenant(scope.value));
};

export const add__SINGULAR_PASCAL__ = async (
  ctx: Ctx,
  input: New__SINGULAR_PASCAL__,
  deps: __SINGULAR_PASCAL__Deps,
): Promise<Result<__SINGULAR_PASCAL__, AppError>> => {
  const scope = authorizeTenant(ctx, '__SINGULAR_KEBAB__:write');
  if (!scope.ok) return scope;

  const parsed = new__SINGULAR_PASCAL__Schema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid __SINGULAR_KEBAB__', parsed.error.flatten()));

  const __SINGULAR_CAMEL__: __SINGULAR_PASCAL__ = {
    id: deps.ids.nextId(),
    tenantId: scope.value,
    title: parsed.data.title,
    createdBy: ctx.identity.userId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.__PLURAL_CAMEL__.create(__SINGULAR_CAMEL__);
  return ok(__SINGULAR_CAMEL__);
};
