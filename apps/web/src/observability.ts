import { context, trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/react';

/**
 * The active trace id, read from the `@opentelemetry/api` facade first and from
 * Sentry's browser tracing second. `undefined` when nothing is tracing, so the
 * error fallback can degrade gracefully. This is the id a user pastes into a
 * support message.
 */
export const activeTraceId = (): string | undefined =>
  trace.getSpanContext(context.active())?.traceId ?? Sentry.getActiveSpan()?.spanContext().traceId;

/**
 * Composition-root wiring for browser observability. Sentry initialises ONLY
 * when `VITE_SENTRY_DSN` is present; without it the app runs exactly as today —
 * no client, no network. Vendor choice lives here, never in feature code.
 */
export const initWebObservability = (): void => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 1,
    integrations: [Sentry.browserTracingIntegration()],
  });
};

/** Report an error to Sentry when configured; a no-op otherwise. */
export const reportError = (error: unknown): void => {
  if (!Sentry.getClient()) return;
  Sentry.captureException(error);
};
