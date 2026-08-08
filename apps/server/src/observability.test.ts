import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, internal, type Identity } from '#core/domain/index.js';

const h = vi.hoisted(() => ({
  sentry: {
    init: vi.fn(),
    getClient: vi.fn(),
    captureException: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock('@sentry/node', () => h.sentry);

import { captureServerException, startServerObservability } from './observability.js';
import { recordException, telemetryMiddleware } from './telemetry.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

const identity: Identity = {
  userId: 'user-1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  tenantName: 'Acme',
  staffRole: 'owner',
  memberId: null,
};

type Vars = { Variables: { identity?: Identity } };

// Mirror the real app.onError seam (apps/server/src/app.ts): one normalization
// point where both the OTel span and the Sentry sink attach to the same error.
const buildProbeApp = () => {
  const app = new Hono<Vars>();
  app.use('*', telemetryMiddleware);
  app.onError((error, c) => {
    const appError = internal();
    recordException(error);
    captureServerException(error, { appError, identity: c.get('identity') });
    return new Response(JSON.stringify(err(appError)), { status: 500 });
  });
  app.get('/api/boom', (c) => {
    c.set('identity', identity);
    throw new Error('kaboom');
  });
  return app;
};

const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});

beforeAll(() => {
  provider.register();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sentry.flush.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await provider.shutdown();
});

const boom = () =>
  buildProbeApp().request('/api/boom', {
    headers: { traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` },
  });

describe('captureServerException at the app.onError seam', () => {
  it('yields exactly one capture carrying the app-error, trace and tenant tags', async () => {
    h.sentry.getClient.mockReturnValue({ name: 'client' });

    const response = await boom();
    expect(response.status).toBe(500);

    expect(h.sentry.captureException).toHaveBeenCalledTimes(1);
    const call = h.sentry.captureException.mock.calls[0];
    expect(call?.[0]).toBeInstanceOf(Error);
    expect(call?.[0].message).toBe('kaboom');
    const context = call?.[1];
    expect(context.tags['app.error.code']).toBe('internal');
    expect(context.tags['trace.id']).toBe(TRACE_ID);
    expect(context.tags['app.tenant.id']).toBe('tenant-1');
    expect(context.tags['app.tenant.slug']).toBe('acme');
    expect(context.user).toEqual({ id: 'user-1', email: 'demo@agentproofarch.dev' });
  });

  it('no-ops when no DSN configured a Sentry client', async () => {
    h.sentry.getClient.mockReturnValue(undefined);

    const response = await boom();
    expect(response.status).toBe(500);

    expect(h.sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('startServerObservability', () => {
  it('initialises the Sentry sink when SENTRY_DSN is set and drains it on flush', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@example.ingest.sentry.io/1');

    const flush = startServerObservability();

    expect(h.sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://key@example.ingest.sentry.io/1',
        skipOpenTelemetrySetup: true,
        defaultIntegrations: false,
      }),
    );
    expect(flush).toBeTypeOf('function');

    await flush?.();
    expect(h.sentry.flush).toHaveBeenCalledTimes(1);
  });

  it('does not initialise Sentry and returns undefined when nothing is configured', () => {
    const flush = startServerObservability();

    expect(h.sentry.init).not.toHaveBeenCalled();
    expect(flush).toBeUndefined();
  });
});
