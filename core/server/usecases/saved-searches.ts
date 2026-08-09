import {
  createSavedSearchSchema,
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type CreateSavedSearch,
  type Result,
  type SavedSearch,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { IdGenerator, SavedSearchRepository } from '../ports.js';

export interface SavedSearchDeps {
  savedSearches: SavedSearchRepository;
  ids: IdGenerator;
}

export const listSavedSearches = async (
  ctx: Ctx,
  deps: SavedSearchDeps,
): Promise<Result<SavedSearch[], AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  return ok(await deps.savedSearches.listByTenant(scope.value));
};

export const createSavedSearch = async (
  ctx: Ctx,
  input: CreateSavedSearch,
  deps: SavedSearchDeps,
): Promise<Result<SavedSearch, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = createSavedSearchSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid saved search', parsed.error.flatten()));
  return ok(
    await deps.savedSearches.create({
      id: deps.ids.nextId(),
      tenantId: scope.value,
      ...parsed.data,
    }),
  );
};

export const deleteSavedSearch = async (
  ctx: Ctx,
  savedSearchId: string,
  deps: SavedSearchDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const deleted = await deps.savedSearches.delete(scope.value, savedSearchId);
  return deleted ? ok(undefined) : err(notFound('Saved search not found'));
};
