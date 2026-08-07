import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import {
  API_PATHS,
  HTTP_STATUS_BY_ERROR_CODE,
  TENANT_HEADER,
  tenantCreateInputSchema,
  toEnvelope,
  todoCreateInputSchema,
} from '#core/contract/index.js';
import {
  err,
  internal,
  ok,
  unauthorized,
  validation,
  type AppError,
  type Identity,
  type Result,
} from '#core/domain/index.js';
import {
  addTodo,
  createTenant,
  listMyTenants,
  listTodos,
  resolveIdentity,
  type AuthenticatedUser,
} from '#core/server/index.js';
import { BETTER_AUTH_API_PATH_PATTERN } from '#adapters/auth/create-auth.js';

import type { AppDeps } from './composition.js';
import { recordAppError, recordException, telemetryMiddleware } from './telemetry.js';

type Vars = { Variables: { identity: Identity } };

const respond = <T>(result: Result<T, AppError>): Response => {
  const envelope = toEnvelope(result);
  if (!envelope.ok) recordAppError(envelope.error);
  const status = envelope.ok ? 200 : HTTP_STATUS_BY_ERROR_CODE[envelope.error.code];
  return new Response(JSON.stringify(envelope), {
    status,
    // no-store at the one seam every envelope passes through: tenant-scoped
    // JSON must never be stored by any cache (see architecture §HTTP caching).
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};

const tenantlessIdentity = (user: AuthenticatedUser): Identity => ({
  userId: user.userId,
  email: user.email,
  name: user.name,
  tenantId: null,
  tenantSlug: null,
  tenantName: null,
  staffRole: null,
  memberId: null,
});

export const buildApp = (deps: AppDeps) => {
  const app = new Hono<Vars>();

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
        connectSrc: ["'self'"],
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
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 100 * 1024,
      onError: () => respond(err(validation('Request body exceeds the 100KB limit'))),
    }),
  );

  app.use('*', telemetryMiddleware);

  app.onError((error) => {
    recordException(error);
    return respond(err(internal()));
  });

  app.get(API_PATHS.health, async () =>
    respond(
      ok({
        status: 'ok' as const,
        version: '0.1.0',
        database: (await deps.health.pingDatabase()) ? ('up' as const) : ('down' as const),
      }),
    ),
  );

  app.on(['GET', 'POST'], BETTER_AUTH_API_PATH_PATTERN, (c) => deps.auth.handler(c.req.raw));

  app.post(API_PATHS.tenants, async (c) => {
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    if (!user) return respond(err(unauthorized()));
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = tenantCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid tenant payload', parsed.error.flatten())));
    }
    const result = await createTenant({ identity: tenantlessIdentity(user) }, parsed.data, deps);
    return respond(result.ok ? ok({ tenant: result.value }) : result);
  });

  // Everything below is tenant-aware: authenticate, resolve tenant, inject identity.
  app.use('/api/*', async (c, next) => {
    const user = await deps.authPort.getAuthenticatedUser(c.req.raw.headers);
    const identity = await resolveIdentity(
      user,
      {
        host: c.req.header('host') ?? '',
        tenantHeader: c.req.header(TENANT_HEADER) ?? null,
      },
      deps,
    );
    if (!identity.ok) return respond(identity);
    c.set('identity', identity.value);
    await next();
  });

  app.get(API_PATHS.me, (c) => {
    const identity = c.get('identity');
    return respond(
      ok({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        tenant:
          identity.tenantId &&
          identity.tenantSlug &&
          identity.tenantName &&
          (identity.staffRole || identity.memberId)
            ? {
                id: identity.tenantId,
                slug: identity.tenantSlug,
                name: identity.tenantName,
                staffRole: identity.staffRole,
                memberId: identity.memberId,
              }
            : null,
      }),
    );
  });

  app.get(API_PATHS.tenants, async (c) => {
    const result = await listMyTenants({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ tenants: result.value }) : result);
  });

  app.get(API_PATHS.todos, async (c) => {
    const result = await listTodos({ identity: c.get('identity') }, deps);
    return respond(result.ok ? ok({ todos: result.value }) : result);
  });

  app.post(API_PATHS.todos, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = todoCreateInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid todo payload', parsed.error.flatten())));
    }
    const result = await addTodo({ identity: c.get('identity') }, parsed.data, deps);
    return respond(result.ok ? ok({ todo: result.value }) : result);
  });

  return app;
};
