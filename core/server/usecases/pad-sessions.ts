import {
  err,
  forbidden,
  notFound,
  ok,
  padSessionRequestInputSchema,
  padSubmittedStrokesSchema,
  PAD_SESSION_TTL_MS,
  unauthorized,
  validation,
  type AppError,
  type PadSession,
  type PadSignatureRequest,
  type PadSubmittedStrokes,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { IdGenerator, PadSessionRepository, PadSessionSecretPort } from '../ports.js';

interface PadSessionDeps {
  ids: IdGenerator;
  padSessions: PadSessionRepository;
  padSessionSecrets: PadSessionSecretPort;
}

type PublicPadSession = Omit<PadSession, 'secretHash' | 'submittedStrokes'>;

const isExpired = (session: PadSession): boolean =>
  Date.parse(session.expiresAt) <= Date.now();

const verifySecret = (
  session: PadSession,
  secret: string,
  deps: Pick<PadSessionDeps, 'padSessionSecrets'>,
): boolean => deps.padSessionSecrets.matchesHash(secret, session.secretHash);

const findDesktopSession = async (
  tenantId: string,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PadSession, AppError>> => {
  const session = await deps.padSessions.findById(tenantId, sessionId);
  return session ? ok(session) : err(notFound('Pad session not found'));
};

const findPadSession = async (
  tenantId: string,
  sessionId: string,
  secret: string,
  deps: Pick<PadSessionDeps, 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<PadSession, AppError>> => {
  const session = await deps.padSessions.findById(tenantId, sessionId);
  if (!session || !verifySecret(session, secret, deps) || isExpired(session)) {
    return err(unauthorized('Invalid pad session'));
  }
  return ok(session);
};

export const createPadSession = async (
  ctx: Ctx,
  deps: PadSessionDeps,
): Promise<Result<{ session: PublicPadSession; secret: string }, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const secret = deps.padSessionSecrets.generate();
  const expiresAt = new Date(Date.now() + PAD_SESSION_TTL_MS).toISOString();
  const session = await deps.padSessions.create({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    createdBy: ctx.identity.userId,
    secretHash: deps.padSessionSecrets.hash(secret),
    expiresAt,
  });
  return ok({
    session: {
      id: session.id,
      tenantId: session.tenantId,
      createdBy: session.createdBy,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      currentRequest: session.currentRequest,
    },
    secret,
  });
};

export const getPadState = async (
  ctx: Ctx,
  sessionId: string,
  secret: string,
  deps: Pick<PadSessionDeps, 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<{ status: PadSession['status']; currentRequest: PadSession['currentRequest'] }, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const session = await findPadSession(scope.value, sessionId, secret, deps);
  if (!session.ok) return session;
  return ok({
    status: session.value.status,
    currentRequest: session.value.status === 'active' ? session.value.currentRequest : null,
  });
};

export const requestPadSignature = async (
  ctx: Ctx,
  sessionId: string,
  input: unknown,
  deps: Pick<PadSessionDeps, 'ids' | 'padSessions'>,
): Promise<Result<PadSignatureRequest, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = padSessionRequestInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid pad request', parsed.error.flatten()));
  const session = await findDesktopSession(scope.value, sessionId, deps);
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  const request = {
    requestId: deps.ids.nextId(),
    documentTitle: parsed.data.documentTitle,
  };
  const updated = await deps.padSessions.requestSignature(scope.value, sessionId, request);
  return updated ? ok(request) : err(notFound('Pad session not found'));
};

export const submitPadStrokes = async (
  ctx: Ctx,
  sessionId: string,
  secret: string,
  input: unknown,
  deps: Pick<PadSessionDeps, 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = padSubmittedStrokesSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid pad strokes', parsed.error.flatten()));
  const session = await findPadSession(scope.value, sessionId, secret, deps);
  if (!session.ok) return session;
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  if (session.value.currentRequest?.requestId !== parsed.data.requestId) {
    return err(validation('Stale pad request'));
  }
  await deps.padSessions.submitStrokes(scope.value, sessionId, parsed.data);
  return ok(undefined);
};

export const consumePadStrokes = async (
  ctx: Ctx,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PadSubmittedStrokes | null, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await findDesktopSession(scope.value, sessionId, deps);
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  return ok(await deps.padSessions.consumeStrokes(scope.value, sessionId));
};

export const closePadSession = async (
  ctx: Ctx,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  await deps.padSessions.close(scope.value, sessionId);
  return ok(undefined);
};
