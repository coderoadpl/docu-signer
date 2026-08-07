import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSpanContext: vi.fn(),
  sentry: {
    getActiveSpan: vi.fn(),
    getClient: vi.fn(),
    captureException: vi.fn(),
    init: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'browser-tracing' })),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: () => ({}) },
  trace: { getSpanContext: h.getSpanContext },
}));

vi.mock('@sentry/react', () => h.sentry);

import { activeTraceId, initWebObservability, reportError } from './observability.js';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('activeTraceId', () => {
  it('returns the active OTel trace id when present', () => {
    h.getSpanContext.mockReturnValue({ traceId: 'otel-trace' });

    expect(activeTraceId()).toBe('otel-trace');
  });

  it('falls back to the Sentry span trace id', () => {
    h.getSpanContext.mockReturnValue(undefined);
    h.sentry.getActiveSpan.mockReturnValue({ spanContext: () => ({ traceId: 'sentry-trace' }) });

    expect(activeTraceId()).toBe('sentry-trace');
  });

  it('is undefined when nothing is tracing', () => {
    h.getSpanContext.mockReturnValue(undefined);
    h.sentry.getActiveSpan.mockReturnValue(undefined);

    expect(activeTraceId()).toBeUndefined();
  });
});

describe('reportError', () => {
  it('captures the error when a Sentry client is configured', () => {
    h.sentry.getClient.mockReturnValue({ name: 'client' });
    const error = new Error('boom');

    reportError(error);

    expect(h.sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('is a no-op without a Sentry client', () => {
    h.sentry.getClient.mockReturnValue(undefined);

    reportError(new Error('boom'));

    expect(h.sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('initWebObservability', () => {
  it('does nothing without a DSN', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');

    initWebObservability();

    expect(h.sentry.init).not.toHaveBeenCalled();
  });

  it('initialises Sentry when a DSN is configured', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@example.ingest.sentry.io/1');
    vi.stubEnv('MODE', 'test');

    initWebObservability();

    expect(h.sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@example.ingest.sentry.io/1',
        tracesSampleRate: 1,
      }),
    );
  });
});
