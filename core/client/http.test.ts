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

  it('builds file-content and export URLs and maps direct upload status to a Result', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('https://blob.example/upload');
      expect(init).toMatchObject({ method: 'PUT', headers: { authorization: 'token' } });
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      return new Response(null, { status: 201 });
    };
    const client = createApiClient({ baseUrl: '/base', fetchImpl });

    expect(client.fileContentUrl('document/id', 'file/id')).toBe(
      '/base/api/documents/document%2Fid/files/file%2Fid/content',
    );
    expect(client.fileExportUrl('document/id', 'file/id')).toBe(
      '/base/api/documents/document%2Fid/files/file%2Fid/export',
    );
    await expect(
      client.directFileUpload({
        url: 'https://blob.example/upload',
        method: 'PUT',
        headers: { authorization: 'token' },
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it('downloads a bulk export through the write transport', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/export');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ documentIds: ['document-1'] }),
      });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': "attachment; filename*=UTF-8''eksport-dokumentow.zip",
        },
      });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });

    await expect(client.exportDocuments({ documentIds: ['document-1'] })).resolves.toEqual({
      ok: true,
      value: {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'application/zip',
        fileName: 'eksport-dokumentow.zip',
      },
    });
  });

  it('parses bulk export error envelopes', async () => {
    const client = createApiClient({
      baseUrl: '',
      fetchImpl: async () =>
        jsonResponse({ ok: false, error: { code: 'not_found', message: 'Documents not found' } }, 404),
    });

    await expect(client.exportDocuments({ documentIds: ['missing'] })).resolves.toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Documents not found' },
    });
  });

  it('maps failed direct uploads to internal errors', async () => {
    const failed = createApiClient({
      baseUrl: '',
      fetchImpl: async () => new Response(null, { status: 503 }),
    });
    await expect(
      failed.directFileUpload({ url: 'https://blob.example', method: 'PUT', headers: {}, bytes: new Uint8Array() }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });

    const offline = createApiClient({
      baseUrl: '',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await expect(
      offline.directFileUpload({ url: 'https://blob.example', method: 'PUT', headers: {}, bytes: new Uint8Array() }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
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

  it('routes every document action through its contract schema', async () => {
    const document = {
      id: 'document-1',
      tenantId: 'tenant-default',
      title: 'Agreement',
      docType: 'umowa-uod',
      documentDate: '2026-07-18',
      tags: [],
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    };
    const file = {
      id: 'file-1',
      documentId: document.id,
      role: 'source',
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'key',
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    const responses: unknown[] = [
      { documents: [{ ...document, files: [file] }] },
      { document },
      { document: { ...document, files: [file] } },
      { document },
      { deleted: true },
      { upload: { kind: 'server', key: 'key' } },
      { file },
      { file },
      { deleted: true },
    ];
    const requests: { input: string; method: string | undefined; contentType: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        contentType: new Headers(init?.headers).get('content-type'),
      });
      return jsonResponse({ ok: true, data: responses.shift() });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    const input = { title: 'Agreement', docType: 'umowa-uod' as const, documentDate: '2026-07-18' };

    await client.listDocuments({
      docType: 'umowa-uod',
      person: 'Ada',
      text: 'agree',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });
    await client.createDocument(input);
    await client.getDocument(document.id);
    await client.updateDocument(document.id, input);
    await client.deleteDocument(document.id);
    await client.requestFileUpload(document.id, {
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      role: 'source',
    });
    await client.finalizeFileUpload(document.id, {
      key: 'key',
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      role: 'source',
    });
    await client.serverUpload(document.id, {
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      role: 'source',
      bytes: new Uint8Array([1, 2, 3]),
    });
    await client.removeFile(document.id, file.id);

    expect(requests[0]?.input).toContain(
      '/api/documents?docType=umowa-uod&person=Ada&text=agree&dateFrom=2026-01-01&dateTo=2026-12-31',
    );
    expect(requests.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'GET',
      'PATCH',
      'DELETE',
      'POST',
      'POST',
      'POST',
      'DELETE',
    ]);
    expect(requests[7]).toMatchObject({ contentType: 'application/pdf' });
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
