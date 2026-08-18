import { describe, expect, it, vi } from 'vitest';

import { createApiClient, unwrap } from './http.js';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('API client', () => {
  it('gets document seal verification through the file route', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const verification = {
      subject: 'Amazing Company Sp. z o.o.',
      name: 'Amazing Company Sp. z o.o.',
      reason: 'Signed by: Anna Nowak',
      declaredAt: '2026-08-16T10:00:00.000Z',
      byteRangeValid: true,
      digestValid: true,
      signatureValid: true,
      integrity: true,
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      json({ ok: true, data: { verification } }),
    );
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(
      api.getDocumentFileSealVerification(documentId, fileId),
    ).resolves.toEqual({ ok: true, value: { verification } });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `/api/documents/${documentId}/files/${fileId}/seal`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
  });

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

  it('lists, creates, and deletes related-document links through contract paths', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const otherDocumentId = '22222222-2222-4222-8222-222222222222';
    const link = {
      linkId: '33333333-3333-4333-8333-333333333333',
      label: 'podstawa',
      draft: true,
      document: {
        id: otherDocumentId,
        tenantId: 'tenant-default',
        title: 'Umowa ramowa',
        docType: 'umowa-uod',
        documentDate: '2026-08-16',
        periodStart: null,
        periodEnd: null,
        person: null,
        tags: [],
        createdAt: '2026-08-16T10:00:00.000Z',
        updatedAt: '2026-08-16T10:00:00.000Z',
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/approve')) {
        return json({
          ok: true,
          data: {
            link: {
              id: link.linkId,
              tenantId: 'tenant-default',
              fromDocumentId: documentId,
              toDocumentId: otherDocumentId,
              label: 'podstawa',
              draft: false,
            },
          },
        });
      }
      if (init?.method === 'POST') return json({ ok: true, data: { link } });
      if (init?.method === 'DELETE') return json({ ok: true, data: { deleted: true } });
      return json({ ok: true, data: { links: [link] } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.listDocumentLinks(documentId)).resolves.toMatchObject({
      ok: true,
      value: { links: [{ label: 'podstawa' }] },
    });
    await expect(
      api.linkDocuments(documentId, { otherDocumentId, label: 'podstawa' }),
    ).resolves.toMatchObject({ ok: true, value: { link: { label: 'podstawa' } } });
    await expect(api.approveDocumentLink(link.linkId)).resolves.toMatchObject({
      ok: true,
      value: { link: { id: link.linkId, draft: false } },
    });
    await expect(api.unlinkDocuments(documentId, otherDocumentId)).resolves.toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`/api/documents/${documentId}/links`);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ otherDocumentId, label: 'podstawa' }),
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(`/api/document-links/${link.linkId}/approve`);
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `/api/documents/${documentId}/links/${otherDocumentId}`,
    );
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('lists, creates, and deletes document comments through contract paths', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const commentId = '22222222-2222-4222-8222-222222222222';
    const comment = {
      id: commentId,
      tenantId: 'tenant-default',
      documentId,
      author: { accountId: 'user-owner', name: 'Owner' },
      body: 'Treść komentarza',
      draft: true,
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/approve')) {
        return json({ ok: true, data: { comment: { ...comment, draft: false } } });
      }
      if (init?.method === 'POST') return json({ ok: true, data: { comment } });
      if (init?.method === 'DELETE') return json({ ok: true, data: { deleted: true } });
      return json({ ok: true, data: { items: [comment], nextCursor: null } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(
      api.listDocumentComments(documentId, { cursor: 'opaque', limit: 10 }),
    ).resolves.toMatchObject({ ok: true, value: { items: [{ id: commentId }] } });
    await expect(
      api.addDocumentComment(documentId, { body: comment.body }),
    ).resolves.toMatchObject({ ok: true, value: { comment: { id: commentId } } });
    await expect(api.approveDocumentComment(commentId)).resolves.toMatchObject({
      ok: true,
      value: { comment: { id: commentId, draft: false } },
    });
    await expect(api.deleteDocumentComment(documentId, commentId)).resolves.toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `/api/documents/${documentId}/comments?cursor=opaque&limit=10`,
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ body: comment.body }),
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `/api/document-comments/${commentId}/approve`,
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `/api/documents/${documentId}/comments/${commentId}`,
    );
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('lists and resolves document metadata proposals through contract paths', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const proposalId = '22222222-2222-4222-8222-222222222222';
    const document = {
      id: documentId,
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
    const proposal = {
      id: proposalId,
      tenantId: 'tenant-default',
      documentId,
      changes: { title: 'Nowa umowa' },
      creator: { accountId: 'user-owner', name: 'Owner' },
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'PATCH') {
        return json({
          ok: true,
          data: { outcome: 'proposed', document, proposal },
        });
      }
      if (String(input).endsWith('/bulk-approve-pending-drafts')) {
        return json({
          ok: true,
          data: { approved: 1, skipped: 1, metadataProposals: 2, comments: 1, links: 1 },
        });
      }
      if (String(input).endsWith('/approve')) {
        return json({ ok: true, data: { document: { ...document, title: 'Nowa umowa' } } });
      }
      if (String(input).endsWith('/reject')) {
        return json({ ok: true, data: { deleted: true } });
      }
      return json({ ok: true, data: { items: [proposal], nextCursor: null } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(
      api.proposeDocumentUpdate(documentId, { title: 'Nowa umowa' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { outcome: 'proposed', proposal: { id: proposalId } },
    });
    await expect(
      api.listDocumentMetadataProposals(documentId, { cursor: 'next', limit: 5 }),
    ).resolves.toMatchObject({ ok: true, value: { items: [{ id: proposalId }] } });
    await expect(api.approveDocumentMetadataProposal(proposalId)).resolves.toMatchObject({
      ok: true,
      value: { document: { title: 'Nowa umowa' } },
    });
    await expect(api.rejectDocumentMetadataProposal(proposalId)).resolves.toEqual({
      ok: true,
      value: { deleted: true },
    });
    await expect(
      api.bulkApprovePendingDrafts({ documentIds: [documentId, proposalId] }),
    ).resolves.toEqual({
      ok: true,
      value: { approved: 1, skipped: 1, metadataProposals: 2, comments: 1, links: 1 },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`/api/documents/${documentId}`);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ title: 'Nowa umowa' }),
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `/api/documents/${documentId}/metadata-proposals?cursor=next&limit=5`,
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `/api/document-metadata-proposals/${proposalId}/approve`,
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `/api/document-metadata-proposals/${proposalId}/reject`,
    );
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe(
      '/api/documents/bulk-approve-pending-drafts',
    );
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
      signerAccountId: 'account-1',
      pendingDrafts: 'true',
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
      '/api/documents?person=Jan&tag=podpis&dateFrom=2026-01-01&signatureStatus=needs-signature&signerAccountId=account-1&pendingDrafts=true',
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

  it('lists tenant accounts through the contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(json({
        ok: true,
        data: { accounts: [{ accountId: 'account-1', name: 'Maria Choma' }] },
      })),
    );
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.listTenantAccounts()).resolves.toEqual({
      ok: true,
      value: { accounts: [{ accountId: 'account-1', name: 'Maria Choma' }] },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('/api/tenant-accounts');
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

  it('calls document type dictionary routes through the contract', async () => {
    const documentType = {
      slug: 'umowa-z-klientem',
      label: 'Umowa z klientem',
      position: 60,
      hidden: false,
    };
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'DELETE') return json({ ok: true, data: { deleted: true } });
      if (init?.method === 'PATCH') {
        return json({ ok: true, data: { documentType: { ...documentType, label: 'Kontrakt' } } });
      }
      if (init?.method === 'POST') return json({ ok: true, data: { documentType } });
      return json({ ok: true, data: { documentTypes: [documentType] } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.listDocumentTypes()).resolves.toMatchObject({
      ok: true,
      value: { documentTypes: [documentType] },
    });
    await api.createDocumentType({ label: 'Umowa z klientem' });
    await api.renameDocumentType(documentType.slug, { label: 'Kontrakt' });
    await api.setDocumentTypeHidden(documentType.slug, { hidden: true });
    await api.deleteDocumentType(documentType.slug);

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/document-types',
      '/api/document-types',
      '/api/document-types/umowa-z-klientem',
      '/api/document-types/umowa-z-klientem/hidden',
      '/api/document-types/umowa-z-klientem',
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ label: 'Umowa z klientem' }),
    });
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ label: 'Kontrakt' }),
    });
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    });
    expect(fetchImpl.mock.calls[4]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('calls hidden filter value routes through the contract', async () => {
    const hiddenFilterValue = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-default',
      kind: 'person',
      value: 'Jan Kowalski',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'GET') {
        return json({ ok: true, data: { hiddenFilterValues: [hiddenFilterValue] } });
      }
      return String(input).endsWith('/unhide')
        ? json({ ok: true, data: { unhidden: true } })
        : json({ ok: true, data: { hiddenFilterValue } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.listHiddenFilterValues()).resolves.toMatchObject({
      ok: true,
      value: { hiddenFilterValues: [hiddenFilterValue] },
    });
    await api.hideFilterValue({ kind: 'person', value: 'Jan Kowalski' });
    await api.unhideFilterValue({ kind: 'person', value: 'Jan Kowalski' });

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/hidden-filter-values',
      '/api/hidden-filter-values',
      '/api/hidden-filter-values/unhide',
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ kind: 'person', value: 'Jan Kowalski' }),
    });
  });

  it('calls document approval, API token and preference routes through the contract', async () => {
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
      if (url.endsWith('/unapprove')) return json({ ok: true, data: { document } });
      if (url.endsWith('/approve')) return json({ ok: true, data: { document } });
      if (url.endsWith('/waive-signature')) return json({ ok: true, data: { document } });
      if (url.endsWith('/require-signature')) return json({ ok: true, data: { document } });
      if (url.endsWith('/api/api-tokens') && init?.method === 'GET') {
        return json({ ok: true, data: { apiTokens: [token] } });
      }
      if (url.endsWith('/api/api-tokens') && init?.method === 'POST') {
        return json({ ok: true, data: { apiToken: token, value: 'pat_secret' } });
      }
      if (url.endsWith('/api/me/preferences/documents.columns') && init?.method === 'GET') {
        return json({ ok: true, data: { preference: null } });
      }
      if (url.endsWith('/api/me/preferences/documents.columns') && init?.method === 'PUT') {
        return json({
          ok: true,
          data: {
            preference: {
              userId: 'user-1',
              key: 'documents.columns',
              value: { order: ['title'], visible: ['title'] },
              updatedAt: '2026-08-02T10:00:00.000Z',
            },
          },
        });
      }
      return json({ ok: true, data: { revoked: true } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await api.approveDocument(document.id);
    await api.unapproveDocument(document.id);
    await api.waiveDocumentSignature(document.id);
    await api.requireDocumentSignature(document.id);
    await api.listApiTokens();
    await api.createApiToken({ name: 'Importer', scopes: ['write:draft'] });
    await api.revokeApiToken(token.id);
    await api.getUserPreference('documents.columns');
    await api.setUserPreference('documents.columns', {
      value: { order: ['title'], visible: ['title'] },
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`/api/documents/${document.id}/approve`);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(`/api/documents/${document.id}/unapprove`);
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `/api/documents/${document.id}/waive-signature`,
    );
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `/api/documents/${document.id}/require-signature`,
    );
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe('/api/api-tokens');
    expect(fetchImpl.mock.calls[4]?.[1]).toMatchObject({ method: 'GET' });
    expect(fetchImpl.mock.calls[5]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Importer', scopes: ['write:draft'] }),
    });
    expect(String(fetchImpl.mock.calls[6]?.[0])).toBe(`/api/api-tokens/${token.id}/revoke`);
    expect(String(fetchImpl.mock.calls[7]?.[0])).toBe('/api/me/preferences/documents.columns');
    expect(fetchImpl.mock.calls[7]?.[1]).toMatchObject({ method: 'GET' });
    expect(fetchImpl.mock.calls[8]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ value: { order: ['title'], visible: ['title'] } }),
    });
  });

  it('calls pad session routes and keeps the secret in a header', async () => {
    const request = {
      requestId: '22222222-2222-4222-8222-222222222222',
      documentTitle: 'Umowa',
    };
    const submittedStrokes = {
      requestId: request.requestId,
      inkColor: 'black' as const,
      sourceSize: { width: 834, height: 620 },
      strokes: [
        {
          points: [
            { x: 0.1, y: 0.2, pressure: 0.5 },
            { x: 0.3, y: 0.4, pressure: 0.7 },
          ],
        },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/pad-sessions')) {
        return json({
          ok: true,
          data: {
            secret: 'pad_secret',
            session: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: 'tenant-default',
              createdBy: 'user-owner',
              status: 'active',
              createdAt: '2026-08-04T10:00:00.000Z',
              expiresAt: '2026-08-04T14:00:00.000Z',
              lastPolledAt: null,
              currentRequest: null,
            },
          },
        });
      }
      if (url.endsWith('/state')) {
        return json({ ok: true, data: { status: 'active', currentRequest: request } });
      }
      if (url.endsWith('/request')) return json({ ok: true, data: { request } });
      if (url.endsWith('/share')) {
        return json({
          ok: true,
          data: {
            session: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: 'tenant-default',
              createdBy: 'user-owner',
              mode: 'shared',
              status: 'active',
              createdAt: '2026-08-04T10:00:00.000Z',
              expiresAt: '2026-08-04T14:00:00.000Z',
              lastPolledAt: null,
              currentRequest: null,
            },
          },
        });
      }
      if (url.endsWith('/submit')) return json({ ok: true, data: { submitted: true } });
      if (url.endsWith('/active')) return json({ ok: true, data: { session: null } });
      if (url.endsWith('/join')) {
        return json({
          ok: true,
          data: {
            session: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: 'tenant-default',
              createdBy: 'user-owner',
              status: 'active',
              createdAt: '2026-08-04T10:00:00.000Z',
              expiresAt: '2026-08-04T14:00:00.000Z',
              lastPolledAt: null,
              currentRequest: null,
            },
          },
        });
      }
      if (url.endsWith('/consume')) {
        return json({
          ok: true,
          data: {
            submittedStrokes: {
              ...submittedStrokes,
              contributedBy: { accountId: 'user-pad', label: 'Pad User' },
            },
            lastPolledAt: null,
          },
        });
      }
      return json({ ok: true, data: { closed: true } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await api.createPadSession();
    await api.getActivePadSession();
    await api.joinOwnPadSession();
    await api.sharePadSession('11111111-1111-4111-8111-111111111111');
    await api.getPadState('11111111-1111-4111-8111-111111111111', 'pad_secret');
    await api.requestPadSignature('11111111-1111-4111-8111-111111111111', { documentTitle: 'Umowa' });
    await api.submitPadStrokes('11111111-1111-4111-8111-111111111111', 'pad_secret', submittedStrokes);
    await api.consumePadStrokes('11111111-1111-4111-8111-111111111111');
    await api.closePadSession('11111111-1111-4111-8111-111111111111');
    await api.disconnectPadSession('11111111-1111-4111-8111-111111111111', 'pad_secret');

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('/api/pad-sessions');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      '/api/pad-sessions/active',
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      '/api/pad-sessions/join',
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/share',
    );
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/state',
    );
    expect(fetchImpl.mock.calls[4]?.[1]).toMatchObject({
      headers: { 'x-pad-secret': 'pad_secret' },
    });
    expect(String(fetchImpl.mock.calls[5]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/request',
    );
    expect(String(fetchImpl.mock.calls[6]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/submit',
    );
    expect(fetchImpl.mock.calls[6]?.[1]).toMatchObject({
      headers: { 'x-pad-secret': 'pad_secret' },
      body: JSON.stringify(submittedStrokes),
    });
    expect(String(fetchImpl.mock.calls[7]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/consume',
    );
    expect(String(fetchImpl.mock.calls[8]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/close',
    );
    expect(String(fetchImpl.mock.calls[9]?.[0])).toBe(
      '/api/pad-sessions/11111111-1111-4111-8111-111111111111/disconnect',
    );
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

  it('calls tenant settings and signature record routes through the contract', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const record = {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: 'tenant-default',
      documentId,
      fileId,
      signedBy: 'user-1',
      payload: [
        {
          strokes: [{ points: [{ x: 0.2, y: 0.3, pressure: 0.8 }] }],
          pageIndex: 0,
          placement: { offsetX: 0.1, offsetY: 0.2, scale: 1 },
          inkColor: 'black' as const,
          inkSize: 2,
          contributedBy: 'user-1',
        },
      ],
      signerBoxEntries: null,
      createdAt: '2026-08-07T10:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tenant-settings') && init?.method === 'GET') {
        return json({
          ok: true,
          data: { settings: { tenantId: 'tenant-default', storeSignatureRecords: true, pdfSealEnabled: false, signatureBoxEnabled: false, dateMode: 'declared' } },
        });
      }
      if (url.endsWith('/api/tenant-settings') && init?.method === 'PUT') {
        return json({
          ok: true,
          data: { settings: { tenantId: 'tenant-default', storeSignatureRecords: false, pdfSealEnabled: true, signatureBoxEnabled: true, dateMode: 'actual' } },
        });
      }
      if (init?.method === 'GET') {
        return json({ ok: true, data: { items: [record], nextCursor: null } });
      }
      return json({ ok: true, data: { signatureRecord: record } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await expect(api.getTenantSettings()).resolves.toMatchObject({
      ok: true,
      value: { settings: { storeSignatureRecords: true, pdfSealEnabled: false, signatureBoxEnabled: false, dateMode: 'declared' } },
    });
    await api.updateTenantSettings({ storeSignatureRecords: false });
    await api.listSignatureRecords(documentId, { cursor: 'opaque', limit: 1 });
    await api.createSignatureRecord(documentId, { fileId, payload: record.payload });

    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ storeSignatureRecords: false }),
    });
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `/api/documents/${documentId}/signature-records?cursor=opaque&limit=1`,
    );
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ fileId, payload: record.payload }),
    });
  });

  it('calls every source update request route through the contract', async () => {
    const documentId = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';
    const newSourceFileId = '33333333-3333-4333-8333-333333333333';
    const request = {
      id: requestId,
      tenantId: 'tenant-default',
      documentId,
      requestedBy: 'user-owner',
      newSourceFileId,
      mode: 'transfer' as const,
      status: 'pending' as const,
      approvals: [],
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/pending')) {
        return json({ ok: true, data: { requests: [request] } });
      }
      if (url.endsWith('/source-update-request')) {
        return json({ ok: true, data: { request } });
      }
      return json({ ok: true, data: { request } });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });

    await api.getActiveSourceUpdateRequest(documentId);
    await api.listPendingSourceUpdateRequests();
    await api.createSourceUpdateRequest(documentId, {
      newSourceFileId,
      mode: 'transfer',
    });
    await api.decideSourceUpdateRequest(requestId, { decision: 'accept' });
    await api.cancelSourceUpdateRequest(requestId);
    await api.completeSourceUpdateRequest(requestId, {
      signedFileId: newSourceFileId,
    });

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      `/api/documents/${documentId}/source-update-request`,
      '/api/source-update-requests/pending',
      `/api/documents/${documentId}/source-update-requests`,
      `/api/source-update-requests/${requestId}/decision`,
      `/api/source-update-requests/${requestId}/cancel`,
      `/api/source-update-requests/${requestId}/complete`,
    ]);
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ newSourceFileId, mode: 'transfer' }),
    });
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ decision: 'accept' }),
    });
    expect(fetchImpl.mock.calls[5]?.[1]).toMatchObject({
      body: JSON.stringify({ signedFileId: newSourceFileId }),
    });
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
