import { describe, expect, it } from 'vitest';

import type { AppError, Result } from '#core/domain/index.js';

import { ApiError, createApiClient, unwrap } from './http.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createApiClient', () => {
  it('parses a successful envelope through the route output schema', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://api.example.test/api/health');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });

      return jsonResponse({
        ok: true,
        data: { status: 'ok', version: '0.1.0', database: 'up' },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      value: { status: 'ok', version: '0.1.0', database: 'up' },
    });
  });

  it('returns the contract AppError from a non-2xx envelope', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: false, error: { code: 'unauthorized', message: 'Login required' } }, 401);
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.me()).resolves.toEqual({
      ok: false,
      error: { code: 'unauthorized', message: 'Login required' },
    });
  });

  it('turns malformed envelopes into failures', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ data: { status: 'ok' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('turns invalid response data into failures', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'unknown' } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('maps a network failure to an internal error naming the path', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('connection refused');
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: expect.stringContaining('/api/health') },
    });
  });

  it('maps a non-JSON response body to an internal error carrying the status', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('<html>oops</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.me()).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', message: expect.stringContaining('502') },
    });
  });

  it('sends a JSON body with content-type on write routes and parses the result', async () => {
    let seen: { method: string | undefined; contentType: string | null; body: unknown } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/tenants');
      seen = {
        method: init?.method,
        contentType: new Headers(init?.headers).get('content-type'),
        body: init?.body,
      };
      return jsonResponse({
        ok: true,
        data: { tenant: { id: 't-new', slug: 'new-co', name: 'New Co' } },
      });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.createTenant({ slug: 'new-co', name: 'New Co' })).resolves.toEqual({
      ok: true,
      value: { tenant: { id: 't-new', slug: 'new-co', name: 'New Co' } },
    });
    expect(seen).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ slug: 'new-co', name: 'New Co' }),
    });
  });

  it('omits the content-type header on bodiless reads', async () => {
    let contentType: string | null = 'unset';
    const fetchImpl: typeof fetch = async (_input, init) => {
      contentType = new Headers(init?.headers).get('content-type');
      return jsonResponse({ ok: true, data: { tenants: [] } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await client.listTenants();

    expect(contentType).toBeNull();
  });

  it('resolves listTodos and addTodo through their route schemas', async () => {
    const todo = {
      id: 'todo-1',
      tenantId: 't-acme',
      title: 'Ship it',
      createdBy: 'u1',
      createdAt: '2026-07-03T00:00:00.000Z',
    };
    const fetchImpl: typeof fetch = async (_input, init) =>
      init?.method === 'GET'
        ? jsonResponse({ ok: true, data: { todos: [todo] } })
        : jsonResponse({ ok: true, data: { todo } });
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.listTodos()).resolves.toEqual({ ok: true, value: { todos: [todo] } });
    await expect(client.addTodo({ title: 'Ship it' })).resolves.toEqual({ ok: true, value: { todo } });
  });

  it('injects the W3C traceparent header when a trace is active', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'up' } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl, traceparent: () => traceparent });

    await client.health();

    expect(seen?.get('traceparent')).toBe(traceparent);
  });

  it('omits the traceparent header cleanly when no trace is active', async () => {
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({ ok: true, data: { status: 'ok', version: '0.1.0', database: 'up' } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl, traceparent: () => undefined });

    await client.health();

    expect(seen?.has('traceparent')).toBe(false);
  });
});

describe('unwrap', () => {
  it('returns the value of a successful result', () => {
    const result: Result<string, AppError> = { ok: true, value: 'hello' };
    expect(unwrap(result)).toBe('hello');
  });

  it('throws ApiError carrying the AppError', () => {
    const appError: AppError = { code: 'conflict', message: 'Already exists' };
    const result: Result<string, AppError> = { ok: false, error: appError };

    expect(() => unwrap(result)).toThrow(ApiError);

    try {
      unwrap(result);
      throw new Error('Expected unwrap to throw');
    } catch (error) {
      if (error instanceof ApiError) {
        expect(error.appError).toBe(appError);
        return;
      }

      throw error;
    }
  });
});
