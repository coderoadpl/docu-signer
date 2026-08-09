import {
  createApiTokenSchema,
  err,
  notFound,
  ok,
  validation,
  type ApiToken,
  type AppError,
  type CreateApiToken,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ApiTokenRepository, ApiTokenSecretPort, IdGenerator } from '../ports.js';

export interface ApiTokenDeps {
  apiTokens: ApiTokenRepository;
  apiTokenSecrets: ApiTokenSecretPort;
  ids: IdGenerator;
}

export interface CreatedApiToken {
  token: ApiToken;
  value: string;
}

export const createApiToken = async (
  ctx: Ctx,
  input: CreateApiToken,
  deps: ApiTokenDeps,
): Promise<Result<CreatedApiToken, AppError>> => {
  const scope = authorizeTenant(ctx, 'api-token:manage');
  if (!scope.ok) return scope;
  const parsed = createApiTokenSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid API token', parsed.error.flatten()));
  const value = deps.apiTokenSecrets.generate();
  const token = await deps.apiTokens.create({
    id: deps.ids.nextId(),
    userId: ctx.identity.userId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    tokenHash: deps.apiTokenSecrets.hash(value),
  });
  return ok({ token, value });
};

export const listApiTokens = async (
  ctx: Ctx,
  deps: ApiTokenDeps,
): Promise<Result<ApiToken[], AppError>> => {
  const scope = authorizeTenant(ctx, 'api-token:manage');
  if (!scope.ok) return scope;
  return ok(await deps.apiTokens.listByUser(ctx.identity.userId));
};

export const revokeApiToken = async (
  ctx: Ctx,
  apiTokenId: string,
  deps: ApiTokenDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'api-token:manage');
  if (!scope.ok) return scope;
  const revoked = await deps.apiTokens.revoke(ctx.identity.userId, apiTokenId);
  return revoked ? ok(undefined) : err(notFound('API token not found'));
};
