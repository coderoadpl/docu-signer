import {
  err,
  forbidden,
  notFound,
  ok,
  padSessionRequestInputSchema,
  padSessionDocumentInputSchema,
  padStrokeSubmissionSchema,
  PAD_SESSION_TTL_MS,
  unauthorized,
  validation,
  type AppError,
  type PadSession,
  type PadCurrentDocument,
  type PadParticipant,
  type PadQueuedSubmission,
  type PadSessionMode,
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

const publicSession = (session: PadSession): PublicPadSession => ({
  id: session.id,
  tenantId: session.tenantId,
  createdBy: session.createdBy,
  mode: session.mode,
  status: session.status,
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
  lastPolledAt: session.lastPolledAt,
  currentRequest: session.currentRequest,
  currentDocument: session.currentDocument,
});

const createForUser = async (
  tenantId: string,
  userId: string,
  mode: PadSessionMode,
  deps: PadSessionDeps,
): Promise<{ session: PublicPadSession; secret: string }> => {
  const secret = deps.padSessionSecrets.generate();
  const session = await deps.padSessions.create({
    id: deps.ids.nextId(),
    tenantId,
    createdBy: userId,
    mode,
    secretHash: deps.padSessionSecrets.hash(secret),
    expiresAt: new Date(Date.now() + PAD_SESSION_TTL_MS).toISOString(),
  });
  return { session: publicSession(session), secret };
};

const findOwnDesktopSession = async (
  tenantId: string,
  userId: string,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PadSession, AppError>> => {
  const session = await deps.padSessions.findById(tenantId, sessionId);
  if (!session) return err(notFound('Pad session not found'));
  return session.createdBy === userId
    ? ok(session)
    : err(forbidden('Pad session belongs to another user'));
};

const findPadSession = async (
  tenantId: string,
  userId: string,
  sessionId: string,
  secret: string,
  deps: Pick<PadSessionDeps, 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<PadSession, AppError>> => {
  const session = await deps.padSessions.findById(tenantId, sessionId);
  if (!session || isExpired(session)) return err(unauthorized('Invalid pad session'));
  if (session.mode !== 'shared' && session.createdBy !== userId) {
    return err(forbidden('Pad session belongs to another user'));
  }
  if (secret) {
    return deps.padSessionSecrets.matchesHash(secret, session.secretHash)
      ? ok(session)
      : err(unauthorized('Invalid pad session'));
  }
  return session.mode === 'shared' || session.createdBy === userId
    ? ok(session)
    : err(forbidden('Pad session belongs to another user'));
};

export const createPadSession = async (
  ctx: Ctx,
  deps: PadSessionDeps,
  mode: PadSessionMode = 'private',
): Promise<Result<{ session: PublicPadSession; secret: string }, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  return ok(await createForUser(scope.value, ctx.identity.userId, mode, deps));
};

export const getActivePadSession = async (
  ctx: Ctx,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PublicPadSession | null, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await deps.padSessions.findActiveByUser(scope.value, ctx.identity.userId);
  if (!session) return ok(null);
  if (!isExpired(session)) return ok(publicSession(session));
  await deps.padSessions.close(scope.value, session.id);
  return ok(null);
};

export const joinOwnPadSession = async (
  ctx: Ctx,
  deps: PadSessionDeps,
): Promise<Result<PublicPadSession, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const shared = await deps.padSessions.findActiveShared(scope.value, ctx.identity.userId);
  if (shared) {
    await deps.padSessions.touchParticipant(scope.value, shared.id, {
      id: deps.ids.nextId(),
      accountId: ctx.identity.userId,
      label: ctx.identity.name,
      lastPolledAt: new Date().toISOString(),
    });
    return ok(publicSession(shared));
  }
  const active = await deps.padSessions.findActiveByUser(scope.value, ctx.identity.userId);
  if (active && !isExpired(active)) return ok(publicSession(active));
  if (active) await deps.padSessions.close(scope.value, active.id);
  const created = await createForUser(scope.value, ctx.identity.userId, 'private', deps);
  return ok(created.session);
};

export const sharePadSession = async (
  ctx: Ctx,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PublicPadSession, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await findOwnDesktopSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    deps,
  );
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  if (session.value.mode === 'shared') return ok(publicSession(session.value));
  const updated = await deps.padSessions.setMode(scope.value, sessionId, 'shared');
  return updated
    ? ok(publicSession(updated))
    : err(notFound('Pad session not found'));
};

export const getPadState = async (
  ctx: Ctx,
  sessionId: string,
  secret: string,
  deps: Pick<PadSessionDeps, 'ids' | 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<{
  mode: PadSession['mode'];
  status: PadSession['status'];
  currentRequest: PadSession['currentRequest'];
  currentDocument: PadSession['currentDocument'];
}, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:read');
  if (!scope.ok) return scope;
  const found = await findPadSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    secret,
    deps,
  );
  if (!found.ok) return found;
  if (found.value.status !== 'active') {
    return ok({
      mode: found.value.mode,
      status: found.value.status,
      currentRequest: null,
      currentDocument: null,
    });
  }
  const lastPolledAt = new Date().toISOString();
  const renewed = await deps.padSessions.renew(
    scope.value,
    sessionId,
    new Date(Date.now() + PAD_SESSION_TTL_MS).toISOString(),
    lastPolledAt,
  );
  if (!renewed) return err(unauthorized('Invalid pad session'));
  if (renewed.mode === 'shared') {
    await deps.padSessions.touchParticipant(scope.value, sessionId, {
      id: deps.ids.nextId(),
      accountId: ctx.identity.userId,
      label: ctx.identity.name,
      lastPolledAt,
    });
  }
  return ok({
    mode: renewed.mode,
    status: renewed.status,
    currentRequest: renewed.currentRequest,
    currentDocument: renewed.currentDocument,
  });
};

export const setPadCurrentDocument = async (
  ctx: Ctx,
  sessionId: string,
  input: unknown,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PadCurrentDocument, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = padSessionDocumentInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid pad document', parsed.error.flatten()));
  const session = await findOwnDesktopSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    deps,
  );
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  if (session.value.mode !== 'shared') return err(forbidden('Pad session is not shared'));
  const updated = await deps.padSessions.setCurrentDocument(
    scope.value,
    sessionId,
    parsed.data.document,
  );
  return updated ? ok(parsed.data.document) : err(notFound('Pad session not found'));
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
  const session = await findOwnDesktopSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    deps,
  );
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
  deps: Pick<PadSessionDeps, 'ids' | 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const parsed = padStrokeSubmissionSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid pad strokes', parsed.error.flatten()));
  const session = await findPadSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    secret,
    deps,
  );
  if (!session.ok) return session;
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  if (session.value.mode === 'shared') {
    if (!session.value.currentDocument) return err(validation('No active pad document'));
    await deps.padSessions.enqueueSubmission(scope.value, sessionId, {
      id: deps.ids.nextId(),
      requestId: parsed.data.requestId ?? null,
      document: session.value.currentDocument,
      strokes: parsed.data.strokes,
      inkColor: parsed.data.inkColor,
      sourceSize: parsed.data.sourceSize,
      contributedBy: {
        accountId: ctx.identity.userId,
        label: ctx.identity.name,
      },
      createdAt: new Date().toISOString(),
    });
    return ok(undefined);
  }
  if (
    !parsed.data.requestId ||
    session.value.currentRequest?.requestId !== parsed.data.requestId
  ) {
    return err(validation('Stale pad request'));
  }
  await deps.padSessions.submitStrokes(scope.value, sessionId, {
    requestId: parsed.data.requestId,
    strokes: parsed.data.strokes,
    inkColor: parsed.data.inkColor,
    sourceSize: parsed.data.sourceSize,
    contributedBy: {
      accountId: ctx.identity.userId,
      label: ctx.identity.name,
    },
  });
  return ok(undefined);
};

export const consumePadStrokes = async (
  ctx: Ctx,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<{
  submittedStrokes: PadSubmittedStrokes | null;
  lastPolledAt: string | null;
  participants: PadParticipant[];
  submissions: PadQueuedSubmission[];
}, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await findOwnDesktopSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    deps,
  );
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  if (session.value.mode === 'shared') {
    const [participants, submissions] = await Promise.all([
      deps.padSessions.listParticipants(scope.value, sessionId),
      deps.padSessions.listSubmissions(scope.value, sessionId),
    ]);
    return ok({
      submittedStrokes: null,
      lastPolledAt: session.value.lastPolledAt,
      participants,
      submissions,
    });
  }
  return ok({
    submittedStrokes: await deps.padSessions.consumeStrokes(scope.value, sessionId),
    lastPolledAt: session.value.lastPolledAt,
    participants: [],
    submissions: [],
  });
};

export const consumePadSubmission = async (
  ctx: Ctx,
  sessionId: string,
  submissionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<PadQueuedSubmission, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await findOwnDesktopSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    deps,
  );
  if (!session.ok) return session;
  if (isExpired(session.value)) return err(unauthorized('Pad session expired'));
  if (session.value.status !== 'active') return err(forbidden('Pad session is closed'));
  const submission = await deps.padSessions.consumeSubmission(
    scope.value,
    sessionId,
    submissionId,
  );
  return submission ? ok(submission) : err(notFound('Pad submission not found'));
};

export const closePadSession = async (
  ctx: Ctx,
  sessionId: string,
  deps: Pick<PadSessionDeps, 'padSessions'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await deps.padSessions.findById(scope.value, sessionId);
  if (!session) return ok(undefined);
  if (session.createdBy !== ctx.identity.userId) {
    return err(forbidden('Pad session belongs to another user'));
  }
  await deps.padSessions.close(scope.value, sessionId);
  return ok(undefined);
};

export const disconnectPadSession = async (
  ctx: Ctx,
  sessionId: string,
  secret: string,
  deps: Pick<PadSessionDeps, 'padSessions' | 'padSessionSecrets'>,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'document:write');
  if (!scope.ok) return scope;
  const session = await findPadSession(
    scope.value,
    ctx.identity.userId,
    sessionId,
    secret,
    deps,
  );
  if (!session.ok) return session;
  if (session.value.mode === 'shared') {
    await deps.padSessions.removeParticipant(
      scope.value,
      sessionId,
      ctx.identity.userId,
    );
    return ok(undefined);
  }
  await deps.padSessions.close(scope.value, sessionId);
  return ok(undefined);
};
