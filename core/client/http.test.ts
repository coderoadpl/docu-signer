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
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json({
        ok: true,
        data: {
          document: {
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
          },
        },
      }),
    );
    const api = createApiClient({ baseUrl: '', fetchImpl });
    await api.listDocuments({ person: 'Jan', dateFrom: '2026-01-01' });
    await api.createDocument({
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      tags: [],
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      '/api/documents?person=Jan&dateFrom=2026-01-01',
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
