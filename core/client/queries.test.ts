import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from './http.js';
import {
  createDocumentMutation,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  meQuery,
} from './queries.js';

const response = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200 }));

describe('document query descriptors', () => {
  it('uses stable document scopes and delegates reads to the API client', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      response({ documents: [] }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = documentsQuery(api, { text: 'umowa' });
    expect(query.queryKey).toEqual(['documents', 'list', { text: 'umowa' }]);
    await api.listDocuments({ text: 'umowa' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/documents?text=umowa');
    expect(documentsInvalidates()).toEqual({ queryKey: ['documents'] });
  });

  it('builds identity and detail reads', () => {
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: () => response({}),
    });
    expect(meQuery(api).queryKey).toEqual(['me']);
    expect(documentQuery(api, 'document-1').queryKey).toEqual([
      'documents',
      'detail',
      'document-1',
    ]);
  });

  it('builds the document create mutation', async () => {
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: () =>
        response({
          document: {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: 'tenant-default',
            title: 'Umowa',
            docType: 'umowa-uod',
            documentDate: '2026-08-01',
            person: null,
            tags: [],
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        }),
    });
    const mutation = createDocumentMutation(api);
    expect(mutation.mutationKey).toEqual(['documents', 'create']);
  });
});
