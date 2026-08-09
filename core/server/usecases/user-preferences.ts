import {
  err,
  ok,
  setUserPreferenceSchema,
  userPreferenceKeySchema,
  validation,
  type AppError,
  type Result,
  type SetUserPreference,
  type UserPreference,
} from '#core/domain/index.js';

import { authorize } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { UserPreferenceRepository } from '../ports.js';

export interface UserPreferenceDeps {
  userPreferences: UserPreferenceRepository;
}

export const getUserPreference = async (
  ctx: Ctx,
  key: string,
  deps: UserPreferenceDeps,
): Promise<Result<UserPreference | null, AppError>> => {
  const denial = authorize(ctx, 'user-preference:manage');
  if (denial) return err(denial);
  const parsed = userPreferenceKeySchema.safeParse(key);
  if (!parsed.success) return err(validation('Invalid preference key', parsed.error.flatten()));
  return ok(await deps.userPreferences.get(ctx.identity.userId, parsed.data));
};

export const setUserPreference = async (
  ctx: Ctx,
  key: string,
  input: SetUserPreference,
  deps: UserPreferenceDeps,
): Promise<Result<UserPreference, AppError>> => {
  const denial = authorize(ctx, 'user-preference:manage');
  if (denial) return err(denial);
  const parsedKey = userPreferenceKeySchema.safeParse(key);
  if (!parsedKey.success) return err(validation('Invalid preference key', parsedKey.error.flatten()));
  const parsedInput = setUserPreferenceSchema.safeParse(input);
  if (!parsedInput.success) return err(validation('Invalid preference value', parsedInput.error.flatten()));
  return ok(
    await deps.userPreferences.set(
      ctx.identity.userId,
      parsedKey.data,
      parsedInput.data.value,
    ),
  );
};
