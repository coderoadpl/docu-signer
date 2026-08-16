import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import {
  API_PATHS,
  API_ROUTES,
  PAD_SECRET_HEADER,
  apiTokenCreateInputSchema,
  invitationCreateInputSchema,
  TENANT_HEADER,
  documentCreateInputSchema,
  documentCommentCreateInputSchema,
  documentCommentListInputSchema,
  documentLinkCreateInputSchema,
  documentFileMoveInputSchema,
  documentListInputSchema,
  documentUpdateInputSchema,
  exportDocumentsInputSchema,
  fileUploadRequestInputSchema,
  finalizeFileUploadInputSchema,
  padSessionCreateInputSchema,
  padSessionDocumentInputSchema,
  padSessionRequestInputSchema,
  padSessionSubmitInputSchema,
  savedSearchCreateInputSchema,
  serverUploadMetadataSchema,
  signatureRecordCreateInputSchema,
  signatureRecordListInputSchema,
  sourceUpdateRequestCompleteInputSchema,
  sourceUpdateRequestCreateInputSchema,
  sourceUpdateRequestDecisionInputSchema,
  tenantSettingsUpdateInputSchema,
  userPreferenceKeyInputSchema,
  userPreferenceSetInputSchema,
} from '#core/contract/index.js';
import {
  err,
  forbidden,
  internal,
  MAX_PAD_STROKES_BYTES,
  notFound,
  ok,
  PAD_STROKES_TOO_LARGE_MESSAGE,
  unavailable,
  validation,
  type Identity,
} from '#core/domain/index.js';
import {
  approveDocument,
  approveDocumentComment,
  approveDocumentLink,
  addDocumentComment,
  createApiToken,
  createInvitation,
  createDocument,
  createPadSession,
  createSavedSearch,
  createSignatureRecord,
  createSourceUpdateRequest,
  closePadSession,
  consumePadStrokes,
  consumePadSubmission,
  disconnectPadSession,
  decideSourceUpdateRequest,
  cancelSourceUpdateRequest,
  completeSourceUpdateRequest,
  deleteDocument,
  deleteDocumentComment,
  deleteSavedSearch,
  exportDocuments,
  finalizeFileUpload,
  getDocument,
  getFileContent,
  getFileExport,
  getUserPreference,
  getTenantSettings,
  getActivePadSession,
  getActiveSourceUpdateRequest,
  getPadState,
  joinOwnPadSession,
  linkDocuments,
  listDocuments,
  listDocumentComments,
  listDocumentLinks,
  listApiTokens,
  listInvitations,
  listTrashedDocuments,
  listSavedSearches,
  listSignatureRecords,
  listTenantAccounts,
  listPendingSourceUpdateRequests,
  moveDocumentFile,
  purgeDocument,
  removeFile,
  resolveApiTokenIdentity,
  resolveIdentity,
  restoreDocument,
  revokeApiToken,
  revokeInvitation,
  requestFileUpload,
  requestPadSignature,
  requireDocumentSignature,
  setPadCurrentDocument,
  serverUpload,
  setUserPreference,
  submitPadStrokes,
  updateTenantSettings,
  updateDocument,
  unapproveDocument,
  unlinkDocuments,
  waiveDocumentSignature,
  type Ctx,
} from '#core/server/index.js';
import { BETTER_AUTH_API_PATH_PATTERN } from '#adapters/auth/create-auth.js';

import type { AppDeps } from './composition.js';
import { captureServerException } from './observability.js';
import { cleanExportBytes } from './clean-export.js';
import {
  archiveEntries,
  singleExportFileName,
  zipResponseStream,
} from './export-files.js';
import { registerPublicRoutes } from './public-app.js';
import { respond } from './respond.js';
import { recordException, telemetryMiddleware } from './telemetry.js';
import { APP_VERSION } from './version.js';

type Vars = { Variables: { identity: Identity } };

// The Better Auth namespace prefix, derived from the one sanctioned pattern so no
// route string is spelled by hand (lint bans literal auth routes outside adapters).
const BETTER_AUTH_PATH_PREFIX = BETTER_AUTH_API_PATH_PATTERN.slice(0, -1);
const INLINE_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
const API_TOKEN_PREFIX = 'pat_';

const bearerToken = (authorization: string | undefined): string | null => {
  if (authorization === undefined) return null;
  const [scheme, value, extra] = authorization.trim().split(/\s+/);
  return scheme?.toLowerCase() === 'bearer' && value !== undefined && extra === undefined
    ? value
    : null;
};

const attachmentHeaders = (
  fileName: string,
  contentType: string,
  disposition: 'inline' | 'attachment' = 'attachment',
): HeadersInit => {
  const encodedName = encodeURIComponent(fileName);
  const fallbackName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return {
    'content-type': contentType,
    'content-disposition': `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    'cache-control': 'private, no-store',
  };
};

const bytesResponse = (
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
): Response => {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, { headers: attachmentHeaders(fileName, contentType) });
};

export const buildApp = (deps: AppDeps) => {
  const app = new Hono<Vars>();

  const ctxOf = (identity: Identity): Ctx => ({ identity });

  // Security baseline (architecture §Security baseline). style-src allows
  // inline because emotion injects runtime <style> tags; scripts stay 'self'.
  // On Vercel the static SPA bypasses this function — vercel.json carries the
  // same headers for non-/api/ paths; this middleware covers API + self-host.
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'https://vercel.com'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );
  // JSON payloads are small; a 100KB cap is a cheap DoS floor under Vercel's
  // 4.5MB platform backstop. The over-limit response stays an envelope so
  // clients never see a non-JSON body from the API.
  const jsonBodyLimit = bodyLimit({
    maxSize: 100 * 1024,
    onError: () => respond(err(validation('Request body exceeds the 100KB limit'))),
  });
  const padSubmitBodyLimit = bodyLimit({
    maxSize: MAX_PAD_STROKES_BYTES,
    onError: () => respond(err(validation(PAD_STROKES_TOO_LARGE_MESSAGE))),
  });
  const serverUploadBodyLimit = bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: () => respond(err(validation('Upload exceeds the 25MB limit'))),
  });
  const signatureRecordBodyLimit = bodyLimit({
    maxSize: 4 * 1024 * 1024,
    onError: () => respond(err(validation('Signature record exceeds the 4MB limit'))),
  });
  const jsonBodyRoutes = Object.values(API_ROUTES).filter(
    (route) =>
      route.method !== 'GET' &&
      route.path !== API_ROUTES.documentFileServerUpload.path &&
      route.path !== API_ROUTES.padSessionSubmit.path &&
      route.path !== API_ROUTES.signatureRecordsCreate.path,
  );
  for (const route of jsonBodyRoutes) app.use(route.path, jsonBodyLimit);
  app.use(API_ROUTES.padSessionSubmit.path, padSubmitBodyLimit);
  app.use(API_ROUTES.signatureRecordsCreate.path, signatureRecordBodyLimit);
  app.use(BETTER_AUTH_API_PATH_PATTERN, jsonBodyLimit);
  app.use(API_ROUTES.documentFileServerUpload.path, serverUploadBodyLimit);

  app.use('*', telemetryMiddleware);

  // The one server error seam: an unhandled throw (an infra rejection a
  // use-case never catches) is normalized to `internal` exactly here. Both
  // observers attach to that single error — the OTel span and the Sentry sink —
  // so there is one capture path, never scattered `captureException` calls.
  app.onError((error, c) => {
    const appError = internal();
    recordException(error);
    captureServerException(error, { appError, identity: c.get('identity') });
    return respond(err(appError));
  });

  // Health surface (public, before tenant resolution): liveness never touches
  // the database; readiness gates on it (503 when down); the compat `/api/health`
  // reports the database inline at 200. All three carry the deploy attestation.
  const attestation = { version: APP_VERSION, sha: deps.commitSha };

  app.get(API_PATHS.healthLive, () => respond(ok({ status: 'ok' as const, ...attestation })));

  app.get(API_PATHS.healthReady, async () =>
    respond(
      (await deps.health.pingDatabase())
        ? ok({ status: 'ok' as const, ...attestation, database: 'up' as const })
        : err(unavailable('Database is not reachable')),
    ),
  );

  app.get(API_PATHS.health, async () =>
    respond(
      ok({
        status: 'ok' as const,
        ...attestation,
        database: (await deps.health.pingDatabase()) ? ('up' as const) : ('down' as const),
      }),
    ),
  );

  app.on(['GET', 'POST'], BETTER_AUTH_API_PATH_PATTERN, (c) => deps.auth.handler(c.req.raw));

  // Unauthenticated client config (which optional auth methods are wired), read
  // by the pre-auth login/register pages. Flags only, never a secret. Mounted
  // above the `/api/*` tenant middleware so it answers without a session.
  app.get(API_PATHS.config, () => respond(ok({
    googleEnabled: deps.googleEnabled,
    passwordResetEnabled: deps.passwordResetEnabled,
    emailConfigured: deps.emailConfigured,
  })));

  // The public, unauthenticated contract group (US-028, §Public surface). Mounted
  // HERE — before the `/api/*` tenant-resolution middleware below — so a request
  // to `/api/public/*` is answered by a terminal handler and never reaches
  // identity resolution or authorization. Open CORS is scoped to this group only.
  registerPublicRoutes(app, deps);

  app.use('/api/*', async (c, next) => {
    const requestInfo = {
      host: c.req.header('host') ?? '',
      tenantHeader: c.req.header(TENANT_HEADER) ?? null,
    };
    const bearer = bearerToken(c.req.header('authorization'));
    const identity =
      bearer?.startsWith(API_TOKEN_PREFIX) === true
        ? await resolveApiTokenIdentity(bearer, requestInfo, deps)
        : await resolveIdentity(
            await deps.authPort.getAuthenticatedUser(c.req.raw.headers),
            requestInfo,
            deps,
          );
    if (!identity.ok) return respond(identity);
    c.set('identity', identity.value);
    await next();
  });

  app.get(API_PATHS.me, (c) => {
    const identity = c.get('identity');
    if (identity.apiToken !== null) {
      return respond(err(forbidden('API tokens cannot access account identity')));
    }
    return respond(
      ok({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        tenant:
          identity.tenantId &&
          identity.tenantSlug &&
          identity.tenantName &&
          identity.staffRole
            ? {
                id: identity.tenantId,
                slug: identity.tenantSlug,
                name: identity.tenantName,
                staffRole: identity.staffRole,
              }
            : null,
      }),
    );
  });

  app.get(API_ROUTES.userPreference.path, async (c) => {
    const parsed = userPreferenceKeyInputSchema.safeParse(c.req.param('key'));
    if (!parsed.success) {
      return respond(err(validation('Invalid preference key', parsed.error.flatten())));
    }
    const result = await getUserPreference(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result.ok ? ok({ preference: result.value }) : result);
  });

  app.put(API_ROUTES.userPreferenceSet.path, async (c) => {
    const parsedKey = userPreferenceKeyInputSchema.safeParse(c.req.param('key'));
    if (!parsedKey.success) {
      return respond(err(validation('Invalid preference key', parsedKey.error.flatten())));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsedBody = userPreferenceSetInputSchema.safeParse(body);
    if (!parsedBody.success) {
      return respond(err(validation('Invalid preference value', parsedBody.error.flatten())));
    }
    const result = await setUserPreference(
      ctxOf(c.get('identity')),
      parsedKey.data,
      parsedBody.data,
      deps,
    );
    return respond(result.ok ? ok({ preference: result.value }) : result);
  });

  app.get(API_ROUTES.tenantSettings.path, async (c) => {
    const result = await getTenantSettings(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ settings: result.value }) : result);
  });

  app.put(API_ROUTES.tenantSettingsUpdate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantSettingsUpdateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid tenant settings', parsed.error.flatten())));
    }
    const result = await updateTenantSettings(
      ctxOf(c.get('identity')),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ settings: result.value }) : result);
  });

  app.get(API_ROUTES.invitations.path, async (c) => {
    const result = await listInvitations(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ invitations: result.value }) : result);
  });

  app.post(API_ROUTES.invitationsCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = invitationCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid invitation', parsed.error.flatten())));
    }
    const result = await createInvitation(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result);
  });

  app.post(API_ROUTES.invitationRevoke.path, async (c) => {
    const result = await revokeInvitation(
      ctxOf(c.get('identity')),
      c.req.param('invitationId'),
      deps,
    );
    return respond(result.ok ? ok({ revoked: true as const }) : result);
  });

  app.get(API_ROUTES.signatureRecords.path, async (c) => {
    const parsed = signatureRecordListInputSchema.safeParse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid signature record pagination', parsed.error.flatten())));
    }
    const result = await listSignatureRecords(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result);
  });

  app.post(API_ROUTES.signatureRecordsCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = signatureRecordCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid signature record', parsed.error.flatten())));
    }
    const result = await createSignatureRecord(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ signatureRecord: result.value }) : result);
  });

  app.get(API_ROUTES.sourceUpdateRequest.path, async (c) => {
    const result = await getActiveSourceUpdateRequest(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.get(API_ROUTES.sourceUpdateRequestsPending.path, async (c) => {
    const result = await listPendingSourceUpdateRequests(
      ctxOf(c.get('identity')),
      deps,
    );
    return respond(result.ok ? ok({ requests: result.value }) : result);
  });

  app.post(API_ROUTES.sourceUpdateRequestsCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = sourceUpdateRequestCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid source update request', parsed.error.flatten())));
    }
    const result = await createSourceUpdateRequest(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_ROUTES.sourceUpdateRequestDecision.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = sourceUpdateRequestDecisionInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid source update decision', parsed.error.flatten())));
    }
    const result = await decideSourceUpdateRequest(
      ctxOf(c.get('identity')),
      c.req.param('requestId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_ROUTES.sourceUpdateRequestCancel.path, async (c) => {
    const result = await cancelSourceUpdateRequest(
      ctxOf(c.get('identity')),
      c.req.param('requestId'),
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_ROUTES.sourceUpdateRequestComplete.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = sourceUpdateRequestCompleteInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid source update completion', parsed.error.flatten())));
    }
    const result = await completeSourceUpdateRequest(
      ctxOf(c.get('identity')),
      c.req.param('requestId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_ROUTES.padSessionsCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const parsed = padSessionCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid pad session', parsed.error.flatten())));
    }
    const result = await createPadSession(
      ctxOf(c.get('identity')),
      deps,
      parsed.data.mode,
    );
    return respond(result);
  });

  app.get(API_ROUTES.padSessionActive.path, async (c) => {
    const result = await getActivePadSession(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ session: result.value }) : result);
  });

  app.post(API_ROUTES.padSessionJoin.path, async (c) => {
    const result = await joinOwnPadSession(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ session: result.value }) : result);
  });

  app.get(API_ROUTES.padSessionState.path, async (c) => {
    const result = await getPadState(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      c.req.header(PAD_SECRET_HEADER) ?? '',
      deps,
    );
    return respond(result);
  });

  app.post(API_ROUTES.padSessionRequest.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = padSessionRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid pad request', parsed.error.flatten())));
    }
    const result = await requestPadSignature(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ request: result.value }) : result);
  });

  app.post(API_ROUTES.padSessionDocument.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = padSessionDocumentInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid pad document', parsed.error.flatten())));
    }
    const result = await setPadCurrentDocument(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.post(API_ROUTES.padSessionSubmit.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = padSessionSubmitInputSchema.safeParse(body);
    if (!parsed.success) {
      if (
        parsed.error.issues.some(
          (issue) => issue.message === PAD_STROKES_TOO_LARGE_MESSAGE,
        )
      ) {
        return respond(
          err(validation(PAD_STROKES_TOO_LARGE_MESSAGE, parsed.error.flatten())),
        );
      }
      return respond(err(validation('Invalid pad strokes', parsed.error.flatten())));
    }
    const result = await submitPadStrokes(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      c.req.header(PAD_SECRET_HEADER) ?? '',
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ submitted: true as const }) : result);
  });

  app.post(API_ROUTES.padSessionConsume.path, async (c) => {
    const result = await consumePadStrokes(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      deps,
    );
    return respond(result);
  });

  app.post(API_ROUTES.padSessionSubmissionConsume.path, async (c) => {
    const result = await consumePadSubmission(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      c.req.param('submissionId'),
      deps,
    );
    return respond(result.ok ? ok({ submission: result.value }) : result);
  });

  app.post(API_ROUTES.padSessionClose.path, async (c) => {
    const result = await closePadSession(ctxOf(c.get('identity')), c.req.param('sessionId'), deps);
    return respond(result.ok ? ok({ closed: true as const }) : result);
  });

  app.post(API_ROUTES.padSessionDisconnect.path, async (c) => {
    const result = await disconnectPadSession(
      ctxOf(c.get('identity')),
      c.req.param('sessionId'),
      c.req.header(PAD_SECRET_HEADER) ?? '',
      deps,
    );
    return respond(result.ok ? ok({ closed: true as const }) : result);
  });

  app.get(API_PATHS.documents, async (c) => {
    const parsed = documentListInputSchema.safeParse({
      docType: c.req.query('docType'),
      person: c.req.query('person'),
      tag: c.req.query('tag'),
      text: c.req.query('text'),
      dateFrom: c.req.query('dateFrom'),
      dateTo: c.req.query('dateTo'),
      signatureStatus: c.req.query('signatureStatus'),
      signerAccountId: c.req.query('signerAccountId'),
      draft: c.req.query('draft'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid document filters', parsed.error.flatten())));
    }
    const result = await listDocuments(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result.ok ? ok({ documents: result.value }) : result);
  });

  app.get(API_ROUTES.tenantAccounts.path, async (c) => {
    const result = await listTenantAccounts(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ accounts: result.value }) : result);
  });

  app.post(API_PATHS.documents, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = documentCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid document payload', parsed.error.flatten())));
    }
    const result = await createDocument(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.get(API_ROUTES.documentsTrash.path, async (c) => {
    const result = await listTrashedDocuments(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ documents: result.value }) : result);
  });

  app.get(API_ROUTES.document.path, async (c) => {
    const result = await getDocument(ctxOf(c.get('identity')), c.req.param('documentId'), deps);
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.get(API_ROUTES.documentComments.path, async (c) => {
    const parsed = documentCommentListInputSchema.safeParse({
      cursor: c.req.query('cursor'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid document comment pagination', parsed.error.flatten())));
    }
    const result = await listDocumentComments(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result);
  });

  app.post(API_ROUTES.documentCommentCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = documentCommentCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid document comment', parsed.error.flatten())));
    }
    const result = await addDocumentComment(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ comment: result.value }) : result);
  });

  app.post(API_ROUTES.documentCommentApprove.path, async (c) => {
    const result = await approveDocumentComment(
      ctxOf(c.get('identity')),
      c.req.param('commentId'),
      deps,
    );
    return respond(result.ok ? ok({ comment: result.value }) : result);
  });

  app.delete(API_ROUTES.documentCommentDelete.path, async (c) => {
    const result = await deleteDocumentComment(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('commentId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  app.patch(API_ROUTES.documentUpdate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = documentUpdateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid document payload', parsed.error.flatten())));
    }
    const result = await updateDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.post(API_ROUTES.documentApprove.path, async (c) => {
    const result = await approveDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.post(API_ROUTES.documentUnapprove.path, async (c) => {
    const result = await unapproveDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.post(API_ROUTES.documentWaiveSignature.path, async (c) => {
    const result = await waiveDocumentSignature(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.post(API_ROUTES.documentRequireSignature.path, async (c) => {
    const result = await requireDocumentSignature(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.get(API_ROUTES.documentLinks.path, async (c) => {
    const result = await listDocumentLinks(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ links: result.value }) : result);
  });

  app.post(API_ROUTES.documentLinkCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = documentLinkCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid document link', parsed.error.flatten())));
    }
    const result = await linkDocuments(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ link: result.value }) : result);
  });

  app.post(API_ROUTES.documentLinkApprove.path, async (c) => {
    const result = await approveDocumentLink(
      ctxOf(c.get('identity')),
      c.req.param('linkId'),
      deps,
    );
    return respond(result.ok ? ok({ link: result.value }) : result);
  });

  app.delete(API_ROUTES.documentLinkDelete.path, async (c) => {
    const result = await unlinkDocuments(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('otherDocumentId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  app.delete(API_ROUTES.documentDelete.path, async (c) => {
    const result = await deleteDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  app.post(API_ROUTES.documentRestore.path, async (c) => {
    const result = await restoreDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.delete(API_ROUTES.documentPurge.path, async (c) => {
    const result = await purgeDocument(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  app.get(API_ROUTES.apiTokens.path, async (c) => {
    const result = await listApiTokens(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ apiTokens: result.value }) : result);
  });

  app.post(API_ROUTES.apiTokensCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = apiTokenCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid API token payload', parsed.error.flatten())));
    }
    const result = await createApiToken(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(
      result.ok
        ? ok({ apiToken: result.value.token, value: result.value.value })
        : result,
    );
  });

  app.post(API_ROUTES.apiTokenRevoke.path, async (c) => {
    const result = await revokeApiToken(
      ctxOf(c.get('identity')),
      c.req.param('apiTokenId'),
      deps,
    );
    return respond(result.ok ? ok({ revoked: true as const }) : result);
  });

  app.post(API_ROUTES.documentFileUploadRequest.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = fileUploadRequestInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid file upload request', parsed.error.flatten())));
    }
    const result = await requestFileUpload(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ upload: result.value }) : result);
  });

  app.post(API_ROUTES.documentFileFinalize.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = finalizeFileUploadInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid uploaded file', parsed.error.flatten())));
    }
    const result = await finalizeFileUpload(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ file: result.value }) : result);
  });

  app.post(API_ROUTES.documentFileServerUpload.path, async (c) => {
    const parsed = serverUploadMetadataSchema.safeParse({
      fileName: c.req.query('fileName'),
      contentType: c.req.header('content-type'),
      role: c.req.query('role'),
      contributorAccountIds: c.req.queries('contributorAccountId'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid server upload metadata', parsed.error.flatten())));
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const result = await serverUpload(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      { ...parsed.data, bytes },
      deps,
    );
    return respond(result.ok ? ok({ file: result.value }) : result);
  });

  app.delete(API_ROUTES.documentFileDelete.path, async (c) => {
    const result = await removeFile(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('fileId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  app.post(API_ROUTES.documentFileMove.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = documentFileMoveInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid document payload', parsed.error.flatten())));
    }
    const result = await moveDocumentFile(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('fileId'),
      parsed.data,
      deps,
    );
    return respond(result.ok ? ok({ document: result.value }) : result);
  });

  app.get(API_ROUTES.documentFileContent.path, async (c) => {
    const result = await getFileContent(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('fileId'),
      deps,
    );
    if (!result.ok) return respond(result);
    const disposition = INLINE_DOCUMENT_CONTENT_TYPES.some(
      (contentType) => contentType === result.value.contentType.trim().toLowerCase(),
    )
      ? 'inline'
      : 'attachment';
    const body = new ArrayBuffer(result.value.bytes.byteLength);
    new Uint8Array(body).set(result.value.bytes);
    return new Response(body, {
      headers: attachmentHeaders(
        result.value.fileName,
        result.value.contentType,
        disposition,
      ),
    });
  });

  app.get(API_ROUTES.documentFileExport.path, async (c) => {
    const result = await getFileExport(
      ctxOf(c.get('identity')),
      c.req.param('documentId'),
      c.req.param('fileId'),
      deps,
    );
    if (!result.ok) return respond(result);
    const bytes = await cleanExportBytes(result.value.bytes, result.value.contentType);
    return bytesResponse(
      bytes,
      singleExportFileName(result.value.document, result.value.file),
      result.value.contentType,
    );
  });

  app.post(API_ROUTES.documentsExport.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = exportDocumentsInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid export request', parsed.error.flatten())));
    }
    const result = await exportDocuments(ctxOf(c.get('identity')), parsed.data, deps);
    if (!result.ok) return respond(result);
    const entries = await archiveEntries(result.value);
    return new Response(zipResponseStream(entries), {
      headers: attachmentHeaders('eksport-dokumentow.zip', 'application/zip'),
    });
  });

  app.get(API_ROUTES.savedSearches.path, async (c) => {
    const result = await listSavedSearches(ctxOf(c.get('identity')), deps);
    return respond(result.ok ? ok({ savedSearches: result.value }) : result);
  });

  app.post(API_ROUTES.savedSearchesCreate.path, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = savedSearchCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid saved search payload', parsed.error.flatten())));
    }
    const result = await createSavedSearch(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result.ok ? ok({ savedSearch: result.value }) : result);
  });

  app.delete(API_ROUTES.savedSearchDelete.path, async (c) => {
    const result = await deleteSavedSearch(
      ctxOf(c.get('identity')),
      c.req.param('savedSearchId'),
      deps,
    );
    return respond(result.ok ? ok({ deleted: true as const }) : result);
  });

  // Total the API surface: any /api/* request that reached here matched no route
  // above — an unknown path or a wrong method on a known path. Return the taxonomy
  // `not_found` envelope through `respond` (so it inherits no-store + is folded
  // into the request span) instead of Hono's bare 404 text/plain, which the client
  // can only degrade to a generic `internal` "Non-JSON response". The Better Auth
  // namespace is carved out: it owns that prefix for every method, so defer to its
  // handler rather than masking a real auth route with our envelope.
  app.all('/api/*', (c) =>
    c.req.path.startsWith(BETTER_AUTH_PATH_PREFIX)
      ? deps.auth.handler(c.req.raw)
      : respond(err(notFound(`No API route for ${c.req.method} ${new URL(c.req.url).pathname}`))),
  );

  return app;
};
