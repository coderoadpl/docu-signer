import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { err, internal, type Identity } from '#core/domain/index.js';

import { recordException, telemetryMiddleware } from './telemetry.js';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

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

const buildProbeApp = () => {
  const app = new Hono<Vars>();
  app.use('*', telemetryMiddleware);
  app.onError((error) => {
    recordException(error);
    return new Response(JSON.stringify(err(internal())), { status: 500 });
  });
  app.get('/api/todos', (c) => {
    c.set('identity', identity);
    return c.json({ ok: true, data: { todos: [] } });
  });
  app.get('/api/boom', () => {
    throw new Error('kaboom');
  });
  return app;
};

const soleSpan = async (): Promise<ReadableSpan> => {
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  const [span] = spans;
  if (!span) throw new Error('expected exactly one span');
  return span;
};

beforeAll(() => {
  provider.register();
});

afterEach(() => {
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
});

describe('telemetryMiddleware', () => {
  it('emits exactly one wide event per request with the expected attributes', async () => {
    const response = await buildProbeApp().request('/api/todos');
    expect(response.status).toBe(200);

    const span = await soleSpan();
    expect(span.name).toBe('GET /api/todos');
    expect(span.attributes['http.request.method']).toBe('GET');
    expect(span.attributes['url.path']).toBe('/api/todos');
    expect(span.attributes['http.response.status_code']).toBe(200);
    expect(typeof span.attributes['http.server.duration_ms']).toBe('number');
    expect(span.attributes['app.user.id']).toBe('user-1');
    expect(span.attributes['app.tenant.id']).toBe('tenant-1');
    expect(span.attributes['app.tenant.slug']).toBe('acme');
  });

  it('continues an incoming W3C traceparent as the same trace', async () => {
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    await buildProbeApp().request('/api/todos', {
      headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` },
    });

    const span = await soleSpan();
    expect(span.spanContext().traceId).toBe(traceId);
  });

  it('records the exception and a 500 status on an unhandled throw', async () => {
    const response = await buildProbeApp().request('/api/boom');
    expect(response.status).toBe(500);

    const span = await soleSpan();
    expect(span.attributes['http.response.status_code']).toBe(500);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((event) => event.name === 'exception')).toBe(true);
  });
});
