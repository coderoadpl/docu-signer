import { context, propagation, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  ATTR_URL_PATH,
} from '@opentelemetry/semantic-conventions';
import { type Context, type Next } from 'hono';

import type { AppError, Identity } from '#core/domain/index.js';

type TelemetryVars = { Variables: { identity?: Identity } };

const tracer = trace.getTracer('apps/server');

const SERVER_ERROR_STATUS = 500;

/**
 * Fold a resolved `AppError` into the active request span. Called from the
 * response path, so the wide event carries the taxonomy code even on the
 * returned-envelope failures that never throw.
 */
export const recordAppError = (error: AppError): void => {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttribute('app.error.code', error.code);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
};

/** Attach an unhandled exception to the active request span. */
export const recordException = (error: unknown): void => {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR });
};

const annotateIdentity = (span: Span, identity: Identity): void => {
  span.setAttribute('app.user.id', identity.userId);
  span.setAttribute('app.user.email', identity.email);
  if (identity.tenantId) span.setAttribute('app.tenant.id', identity.tenantId);
  if (identity.tenantSlug) span.setAttribute('app.tenant.slug', identity.tenantSlug);
};

/**
 * The one request-scoped wide event. Opens a single span, continues an
 * incoming W3C `traceparent`, accrues infra context as the request runs and
 * emits the event exactly once in `finally`. A no-op until an OTel SDK is
 * registered in the composition root — no SDK, no spans, no network.
 */
export const telemetryMiddleware = async (c: Context<TelemetryVars>, next: Next): Promise<void> => {
  const carrier = Object.fromEntries(c.req.raw.headers);
  const parent = propagation.extract(context.active(), carrier);
  const path = new URL(c.req.url).pathname;
  const startedAt = Date.now();

  await tracer.startActiveSpan(`${c.req.method} ${path}`, {}, parent, async (span) => {
    try {
      await next();
    } finally {
      const status = c.res.status;
      span.setAttribute(ATTR_HTTP_REQUEST_METHOD, c.req.method);
      span.setAttribute(ATTR_URL_PATH, path);
      span.setAttribute(ATTR_HTTP_RESPONSE_STATUS_CODE, status);
      span.setAttribute('http.server.duration_ms', Date.now() - startedAt);
      const identity = c.get('identity');
      if (identity) annotateIdentity(span, identity);
      if (status >= SERVER_ERROR_STATUS) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  });
};
