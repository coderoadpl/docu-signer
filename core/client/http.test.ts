import { describe, expect, it, vi } from 'vitest';

import { createApiClient, unwrap } from './http.js';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('API client', () => {
  it('parses health and document responses through the contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/api/health')
        ? json({
            ok: true,
            data: { status: 'ok', database: 'up', version: '1', sha: 'abc' },
          })
        : json({ ok: true, data: { documents: [] } }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });

    expect(await api.health()).toMatchObject({ ok: true, value: { database: 'up' } });
    expect(await api.listDocuments()).toEqual({
      ok: true,
      value: { documents: [] },
    });
  });

  it('sends tenant document filters and write bodies', async () => {
    const document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-default',
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (
        (url.startsWith('/api/documents?') || url.endsWith('/api/documents')) &&
        init?.method === 'GET'
      ) {
        return json({ ok: true, data: { documents: [] } });
      }
      if (url.endsWith('/api/documents/trash')) {
        return json({ ok: true, data: { documents: [{ ...document, files: [] }] } });
      }
      if (init?.method === 'DELETE') return json({ ok: true, data: { deleted: true } });
      return json({
        ok: true,
        data: { document },
      });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    await api.listDocuments({
      person: 'Jan',
      tag: 'podpis',
      dateFrom: '2026-01-01',
      signatureStatus: 'needs-signature',
    });
    await api.createDocument({
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      tags: [],
    });
    await api.listTrashedDocuments();
    await api.restoreDocument('11111111-1111-4111-8111-111111111111');
    await api.purgeDocument('11111111-1111-4111-8111-111111111111');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/api/documents?person=Jan&tag=podpis&dateFrom=2026-01-01&signatureStatus=needs-signature',
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        title: 'Umowa',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        tags: [],
      }),
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe('/api/documents/trash');
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      '/api/documents/11111111-1111-4111-8111-111111111111/restore',
    );
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe(
      '/api/documents/11111111-1111-4111-8111-111111111111/purge',
    );
    expect(fetchImpl.mock.calls[4]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('calls saved search routes through the contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/api/saved-searches') && init?.method === 'GET') {
        return json({ ok: true, data: { savedSearches: [] } });
      }
      if (String(input).endsWith('/api/saved-searches') && init?.method === 'POST') {
        return json({
          ok: true,
          data: {
            savedSearch: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: 'tenant-default',
              name: 'Protokoły',
              filter: { docType: 'protokol' },
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          },
        });
      }
      return json({ ok: true, data: { deleted: true } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await api.listSavedSearches();
    await api.createSavedSearch({ name: 'Protokoły', filter: { docType: 'protokol' } });
    await api.deleteSavedSearch('11111111-1111-4111-8111-111111111111');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('/api/saved-searches');
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Protokoły', filter: { docType: 'protokol' } }),
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      '/api/saved-searches/11111111-1111-4111-8111-111111111111',
    );
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('calls approve and API token routes through the contract', async () => {
    const token = {
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
      name: 'Importer',
      scopes: ['write:draft'],
      createdAt: '2026-08-02T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    };
    const document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-default',
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/approve')) return json({ ok: true, data: { document } });
      if (url.endsWith('/api/api-tokens') && init?.method === 'GET') {
        return json({ ok: true, data: { apiTokens: [token] } });
      }
      if (url.endsWith('/api/api-tokens') && init?.method === 'POST') {
        return json({ ok: true, data: { apiToken: token, value: 'pat_secret' } });
      }
      return json({ ok: true, data: { revoked: true } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await api.approveDocument(document.id);
    await api.listApiTokens();
    await api.createApiToken({ name: 'Importer', scopes: ['write:draft'] });
    await api.revokeApiToken(token.id);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`/api/documents/${document.id}/approve`);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe('/api/api-tokens');
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'GET' });
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Importer', scopes: ['write:draft'] }),
    });
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(`/api/api-tokens/${token.id}/revoke`);
  });

  it('calls public tenant routes and builds file URLs', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/v/')
        ? json({
            ok: true,
            data: {
              slug: 'default',
              displayName: 'Archive',
              contentVersion: 'v1',
              hero: null,
              sections: [],
            },
          })
        : json({ ok: true, data: { slug: 'default', contentVersion: 'v1' } }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });

    await api.publicTenantDiscovery('default');
    await api.publicTenantProfile('default', 'v1');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://archive.example/api/public/tenants/default',
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      'https://archive.example/api/public/tenants/default/v/v1',
    );
    expect(api.documentFileContentUrl('doc 1', 'file 1')).toBe(
      'https://archive.example/api/documents/doc%201/files/file%201/content',
    );
    expect(api.documentFileExportUrl('doc 1', 'file 1')).toBe(
      'https://archive.example/api/documents/doc%201/files/file%201/export',
    );
  });

  it('downloads a single exported document file', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response('pdf', {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="plik.pdf"',
        },
      }),
    );
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.exportDocumentFile('doc', 'file')).resolves.toMatchObject({
      ok: true,
      value: { contentType: 'application/pdf', fileName: 'plik.pdf' },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      '/api/documents/doc/files/file/export',
    );
  });

  it('normalizes network, envelope, and contract failures', async () => {
    const network = createApiClient({
      baseUrl: '',
      fetchImpl: async () => Promise.reject(new Error('offline')),
    });
    expect(await network.health()).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });

    const invalid = createApiClient({
      baseUrl: '',
      fetchImpl: async () => json({ unexpected: true }),
    });
    expect(await invalid.health()).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('unwraps success and throws API errors', () => {
    expect(unwrap({ ok: true, value: 3 })).toBe(3);
    expect(() =>
      unwrap({ ok: false, error: { code: 'unauthorized', message: 'Sign in' } }),
    ).toThrow('Sign in');
  });
});
