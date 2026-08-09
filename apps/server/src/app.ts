import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import {
  API_PATHS,
  API_ROUTES,
  apiTokenCreateInputSchema,
  TENANT_HEADER,
  documentCreateInputSchema,
  documentFileMoveInputSchema,
  documentListInputSchema,
  documentUpdateInputSchema,
  exportDocumentsInputSchema,
  fileUploadRequestInputSchema,
  finalizeFileUploadInputSchema,
  savedSearchCreateInputSchema,
  serverUploadMetadataSchema,
} from '#core/contract/index.js';
import {
  err,
  forbidden,
  internal,
  notFound,
  ok,
  unavailable,
  validation,
  type Identity,
} from '#core/domain/index.js';
import {
  approveDocument,
  createApiToken,
  createDocument,
  createSavedSearch,
  deleteDocument,
  deleteSavedSearch,
  exportDocuments,
  finalizeFileUpload,
  getDocument,
  getFileContent,
  getFileExport,
  listDocuments,
  listApiTokens,
  listTrashedDocuments,
  listSavedSearches,
  moveDocumentFile,
  purgeDocument,
  removeFile,
  resolveApiTokenIdentity,
  resolveIdentity,
  restoreDocument,
  revokeApiToken,
  requestFileUpload,
  serverUpload,
  updateDocument,
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
  const serverUploadBodyLimit = bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: () => respond(err(validation('Upload exceeds the 25MB limit'))),
  });
  const jsonBodyRoutes = Object.values(API_ROUTES).filter(
    (route) =>
      route.method !== 'GET' && route.path !== API_ROUTES.documentFileServerUpload.path,
  );
  for (const route of jsonBodyRoutes) app.use(route.path, jsonBodyLimit);
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

  app.get(API_PATHS.documents, async (c) => {
    const parsed = documentListInputSchema.safeParse({
      docType: c.req.query('docType'),
      person: c.req.query('person'),
      tag: c.req.query('tag'),
      text: c.req.query('text'),
      dateFrom: c.req.query('dateFrom'),
      dateTo: c.req.query('dateTo'),
      signatureStatus: c.req.query('signatureStatus'),
      draft: c.req.query('draft'),
    });
    if (!parsed.success) {
      return respond(err(validation('Invalid document filters', parsed.error.flatten())));
    }
    const result = await listDocuments(ctxOf(c.get('identity')), parsed.data, deps);
    return respond(result.ok ? ok({ documents: result.value }) : result);
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
