import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import * as Sentry from '@sentry/node';

import type { AppError, Identity } from '#core/domain/index.js';
import { observabilityEnvSchema } from '#core/server/config.js';

import { APP_VERSION } from './version.js';

const SENTRY_FLUSH_TIMEOUT_MS = 2000;

/**
 * Composition-root wiring for server observability — the mirror of the browser
 * seam (`apps/web/src/observability.ts`). Both vendor SDKs are contained to this
 * one module per app, wired only when their env var is present, and never
 * wrapped in a port: an exporter/sink is config, not a replaceable domain
 * dependency (port theater).
 *
 *   OTel   — registers a Node tracer provider + OTLP exporter ONLY when an OTLP
 *            endpoint is set; without it `@opentelemetry/api` stays a no-op
 *            facade (no provider, no exporter, no network). The vendor behind
 *            OTLP (Sentry's OTLP ingest, Axiom, ClickHouse) is exporter config.
 *   Sentry — initialises the error sink ONLY when `SENTRY_DSN` is set, as a PURE
 *            sink: `skipOpenTelemetrySetup` (tracing stays OTel's) and no default
 *            integrations, so it installs no global process hooks or
 *            auto-instrumentation. Capture flows through exactly one seam —
 *            `captureServerException`, called only at `app.onError`.
 *
 * Returns a force-flush hook that drains every configured pipeline so serverless
 * targets flush before the function freezes; `undefined` when nothing is wired,
 * so the caller skips its flush.
 */
export const startServerObservability = (): (() => Promise<void>) | undefined => {
  const env = observabilityEnvSchema.parse(process.env);
  const drains: Array<() => Promise<unknown>> = [];

  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      release: APP_VERSION,
      skipOpenTelemetrySetup: true,
      defaultIntegrations: false,
    });
    drains.push(() => Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS));
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: APP_VERSION,
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
    });
    provider.register();
    drains.push(() => provider.forceFlush());
  }

  if (drains.length === 0) return undefined;
  return async () => {
    for (const drain of drains) await drain();
  };
};

/**
 * The single server error seam's Sentry capture. Called only from `app.onError`
 * — the one place a thrown/normalized error is handled — so exactly one
 * `captureException` exists in the tree. A no-op until a DSN configured a client.
 * Tags the event with the resolved taxonomy code and, read cheaply off the
 * active OTel span and request identity, the trace id and tenant, so a Sentry
 * error joins the wide event on the same trace.
 */
export const captureServerException = (
  error: unknown,
  context: { readonly appError: AppError; readonly identity: Identity | undefined },
): void => {
  if (!Sentry.getClient()) return;
  const { appError, identity } = context;
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  Sentry.captureException(error, {
    tags: {
      'app.error.code': appError.code,
      ...(traceId ? { 'trace.id': traceId } : {}),
      ...(identity?.tenantId ? { 'app.tenant.id': identity.tenantId } : {}),
      ...(identity?.tenantSlug ? { 'app.tenant.slug': identity.tenantSlug } : {}),
    },
    ...(identity ? { user: { id: identity.userId, email: identity.email } } : {}),
  });
};
