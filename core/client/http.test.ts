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
        data: { status: 'ok', version: '0.1.0', sha: 'deadbeef', database: 'up' },
      });
    };
    const client = createApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

    await expect(client.health()).resolves.toEqual({
      ok: true,
      value: { status: 'ok', version: '0.1.0', sha: 'deadbeef', database: 'up' },
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

  it('ensureMember posts the input and parses the created flag', async () => {
    const member = {
      id: 'm1',
      tenantId: 'acme',
      userId: null,
      email: 'a@b.com',
      displayName: null,
      tags: [],
      marketingConsents: [],
      externalCustomerIds: [],
      createdAt: '2026-07-10T00:00:00.000Z',
      lastSeenAt: null,
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/members');
      expect(init).toMatchObject({ method: 'POST' });
      return jsonResponse({ ok: true, data: { member, created: true } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    await expect(client.ensureMember({ email: 'a@b.com' })).resolves.toEqual({
      ok: true,
      value: { member, created: true },
    });
  });

  it('exportMember reads the member id from the query string', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(input).toBe('/api/members/export?id=m1');
      return jsonResponse({ ok: false, error: { code: 'not_found', message: 'gone' } }, 404);
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    await expect(client.exportMember('m1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
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

  it('propagates trace context through document binary transfers', async () => {
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const seen: Array<string | null> = [];
    const client = createApiClient({
      baseUrl: '',
      traceparent: () => traceparent,
      fetchImpl: async (_input, init) => {
        seen.push(new Headers(init?.headers).get('traceparent'));
        return jsonResponse(
          { ok: false, error: { code: 'not_found', message: 'probe' } },
          404,
        );
      },
    });
    const documentId = '11111111-1111-4111-8111-111111111111';
    await client.exportDocuments({ documentIds: [documentId] });
    await client.uploadDocumentFile(documentId, {
      fileName: 'scan.pdf',
      contentType: 'application/pdf',
      role: 'source',
      bytes: new Uint8Array([1]),
    });
    expect(seen).toEqual([traceparent, traceparent]);
  });

  it('reads the public tenant discovery route by slug', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe('/api/public/tenants/acme');
      expect(init).toMatchObject({ method: 'GET' });
      return jsonResponse({ ok: true, data: { slug: 'acme', contentVersion: 'abc123' } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    await expect(client.publicTenantDiscovery('acme')).resolves.toEqual({
      ok: true,
      value: { slug: 'acme', contentVersion: 'abc123' },
    });
  });

  it('keys the public profile URL on slug and version', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(input).toBe('/api/public/tenants/acme/v/abc123');
      return jsonResponse({
        ok: true,
        data: { slug: 'acme', displayName: 'Acme Inc', contentVersion: 'abc123' },
      });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    await expect(client.publicTenantProfile('acme', 'abc123')).resolves.toEqual({
      ok: true,
      value: { slug: 'acme', displayName: 'Acme Inc', contentVersion: 'abc123' },
    });
  });

  it('drives the complete document transport surface including binary responses', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const document = {
      id: documentId,
      tenantId: 'tenant-acme',
      title: 'Agreement',
      docType: 'umowa-uod',
      documentDate: '2026-07-27',
      person: null,
      tags: [],
      createdAt: '2026-07-27T10:00:00.000Z',
      updatedAt: '2026-07-27T10:00:00.000Z',
    };
    const file = {
      id: fileId,
      documentId,
      role: 'source',
      fileName: 'agreement.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: `documents/tenant-acme/${documentId}/${fileId}`,
      createdAt: '2026-07-27T10:00:00.000Z',
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path.endsWith('/content') || path.endsWith('/export') || path === '/api/export') {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-type': path === '/api/export' ? 'application/zip' : 'application/pdf',
            'content-disposition': `attachment; filename="fallback.bin"; filename*=UTF-8''${path === '/api/export' ? 'archive.zip' : 'agreement.pdf'}`,
          },
        });
      }
      if (path.includes('/upload-request')) {
        return jsonResponse({
          ok: true,
          data: { upload: { kind: 'server', key: file.storageKey } },
        });
      }
      if (path.includes('/finalize') || path.includes('/files/upload')) {
        return jsonResponse({ ok: true, data: { file } });
      }
      if (init?.method === 'DELETE') {
        return jsonResponse({ ok: true, data: { deleted: true } });
      }
      if (path.includes(`/api/documents/${documentId}`)) {
        return init?.method === 'GET'
          ? jsonResponse({ ok: true, data: { document: { ...document, files: [file] } } })
          : jsonResponse({ ok: true, data: { document } });
      }
      if (init?.method === 'GET') {
        return jsonResponse({ ok: true, data: { documents: [{ ...document, files: [file] }] } });
      }
      return jsonResponse({ ok: true, data: { document } });
    };
    const client = createApiClient({ baseUrl: '', fetchImpl });
    const input = {
      title: document.title,
      docType: 'umowa-uod' as const,
      documentDate: document.documentDate,
    };
    await expect(client.listDocuments({ text: 'Agreement' })).resolves.toMatchObject({ ok: true });
    await expect(client.createDocument(input)).resolves.toMatchObject({ ok: true });
    await expect(client.getDocument(documentId)).resolves.toMatchObject({ ok: true });
    await expect(client.updateDocument(documentId, input)).resolves.toMatchObject({ ok: true });
    await expect(
      client.requestFileUpload(documentId, {
        fileName: file.fileName,
        contentType: file.contentType,
        role: 'source',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.finalizeFileUpload(documentId, {
        key: file.storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: 3,
        role: 'source',
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      client.uploadDocumentFile(documentId, {
        fileName: file.fileName,
        contentType: file.contentType,
        role: 'source',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(client.downloadDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: true,
      value: { fileName: 'agreement.pdf' },
    });
    await expect(client.exportDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: true,
      value: { fileName: 'agreement.pdf' },
    });
    await expect(client.exportDocuments({ documentIds: [documentId] })).resolves.toMatchObject({
      ok: true,
      value: { fileName: 'archive.zip' },
    });
    expect(client.documentFileContentUrl(documentId, fileId)).toBe(
      `/api/documents/${documentId}/files/${fileId}/content`,
    );
    expect(client.documentFileExportUrl(documentId, fileId)).toBe(
      `/api/documents/${documentId}/files/${fileId}/export`,
    );
    await expect(
      client.directFileUpload({
        url: 'https://upload.example',
        method: 'PUT',
        headers: { token: 'signed' },
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(client.deleteDocumentFile(documentId, fileId)).resolves.toMatchObject({ ok: true });
    await expect(client.deleteDocument(documentId)).resolves.toMatchObject({ ok: true });
  });

  it('normalizes document binary transport failures and filename fallbacks', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const failing = createApiClient({
      baseUrl: '',
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await expect(failing.exportDocuments({ documentIds: [documentId] })).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    await expect(
      failing.uploadDocumentFile(documentId, {
        fileName: 'scan.pdf',
        contentType: 'application/pdf',
        role: 'source',
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });
    await expect(
      failing.directFileUpload({
        url: 'https://upload.example',
        method: 'PUT',
        headers: {},
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });

    const denied = createApiClient({
      baseUrl: '',
      fetchImpl: async () =>
        jsonResponse({ ok: false, error: { code: 'not_found', message: 'gone' } }, 404),
    });
    await expect(denied.exportDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    await expect(
      denied.uploadDocumentFile(documentId, {
        fileName: 'scan.pdf',
        contentType: 'application/pdf',
        role: 'source',
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    await expect(
      denied.directFileUpload({
        url: 'https://upload.example',
        method: 'PUT',
        headers: {},
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });

    const malformed = createApiClient({
      baseUrl: '',
      fetchImpl: async () => new Response('not-json', { status: 502 }),
    });
    await expect(malformed.downloadDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    await expect(
      malformed.uploadDocumentFile(documentId, {
        fileName: 'scan.pdf',
        contentType: 'application/pdf',
        role: 'source',
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } });

    const noDisposition = createApiClient({
      baseUrl: '',
      fetchImpl: async () => new Response(new Uint8Array([1])),
    });
    await expect(noDisposition.downloadDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: true,
      value: { fileName: 'download.bin', contentType: 'application/octet-stream' },
    });

    const plainDisposition = createApiClient({
      baseUrl: '',
      fetchImpl: async () =>
        new Response(new Uint8Array([1]), {
          headers: { 'content-disposition': 'attachment; filename="plain.pdf"' },
        }),
    });
    await expect(plainDisposition.downloadDocumentFile(documentId, fileId)).resolves.toMatchObject({
      ok: true,
      value: { fileName: 'plain.pdf' },
    });
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
