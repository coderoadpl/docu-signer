import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './http.js';
import {
  apiTokensInvalidates,
  apiTokensQuery,
  activeSourceUpdateRequestQuery,
  cancelSourceUpdateRequestMutation,
  addDocumentCommentMutation,
  approveDocumentCommentMutation,
  approveDocumentLinkMutation,
  approveDocumentMetadataProposalMutation,
  changePasswordMutation,
  createApiTokenMutation,
  createDocumentMutation,
  createDocumentTypeMutation,
  createSavedSearchMutation,
  createSignatureRecordMutation,
  createSourceUpdateRequestMutation,
  completeSourceUpdateRequestMutation,
  decideSourceUpdateRequestMutation,
  deleteDocumentFileMutation,
  deleteDocumentMutation,
  deleteDocumentTypeMutation,
  deleteDocumentCommentMutation,
  deleteSavedSearchMutation,
  directFileUploadMutation,
  documentQuery,
  documentTypesInvalidates,
  documentTypesQuery,
  hideFilterValueMutation,
  hiddenFilterValuesInvalidates,
  hiddenFilterValuesQuery,
  setDocumentTypeHiddenMutation,
  unhideFilterValueMutation,
  documentCommentsInvalidates,
  documentCommentsQuery,
  documentLinksInvalidates,
  documentLinksQuery,
  documentMetadataProposalsInvalidates,
  documentMetadataProposalsQuery,
  documentFileSealQuery,
  documentsInvalidates,
  documentsQuery,
  exportDocumentsMutation,
  finalizeFileUploadMutation,
  meQuery,
  linkDocumentsMutation,
  moveDocumentFileMutation,
  purgeDocumentMutation,
  pendingSourceUpdateRequestsQuery,
  requestPasswordResetMutation,
  rejectDocumentMetadataProposalMutation,
  requireDocumentSignatureMutation,
  resetPasswordMutation,
  requestFileUploadMutation,
  restoreDocumentMutation,
  renameDocumentTypeMutation,
  revokeApiTokenMutation,
  savedSearchesInvalidates,
  savedSearchesQuery,
  signatureRecordsInvalidates,
  signatureRecordsQuery,
  sourceUpdateRequestsInvalidates,
  trashedDocumentsQuery,
  updateDocumentMutation,
  updateTenantSettingsMutation,
  updateUserMutation,
  unlinkDocumentsMutation,
  uploadDocumentFileMutation,
  waiveDocumentSignatureMutation,
  setUserPreferenceMutation,
  userPreferenceInvalidates,
  userPreferenceQuery,
  tenantSettingsInvalidates,
  tenantSettingsQuery,
  tenantAccountsQuery,
} from './queries.js';
import { ok, type Result, type AppError } from '#core/domain/index.js';
import type { AuthClientPort, AuthSessionResult, PasskeyInfo } from './auth-port.js';

const document = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-default',
  title: 'Umowa',
  docType: 'umowa-uod' as const,
  documentDate: '2026-08-01',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
};

const documentFile = {
  id: '22222222-2222-4222-8222-222222222222',
  documentId: document.id,
  role: 'source' as const,
  fileName: 'agreement.pdf',
  contentType: 'application/pdf',
  sizeBytes: 3,
  storageKey: 'documents/tenant-default/document/file',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const savedSearch = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: 'tenant-default',
  name: 'Protokoły',
  filter: { docType: 'protokol' as const, tag: 'odbiór' },
  createdAt: '2026-08-01T00:00:00.000Z',
};

const apiToken = {
  id: '44444444-4444-4444-8444-444444444444',
  userId: 'user-1',
  name: 'Importer',
  scopes: ['write:draft' as const],
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

const response = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200 }));

const errorResponse = (code: 'conflict' | 'unauthorized', message: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: false, error: { code, message } }), { status: 400 }),
  );

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('document query descriptors', () => {
  it('caches immutable file seal verification by file version', async () => {
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
    const fetchImpl = vi.fn<typeof fetch>(() => response({ verification }));
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const query = documentFileSealQuery(api, document.id, documentFile.id);

    expect(query.queryKey).toEqual([
      'documents',
      'detail',
      document.id,
      'file',
      documentFile.id,
      'seal',
    ]);
    expect(query.staleTime).toBe(Infinity);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({ verification });
  });

  it('executes the list queryFn and unwraps its API result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => response({ documents: [] }));
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = documentsQuery(api, { text: 'umowa' });

    expect(query.queryKey).toEqual(['documents', 'list', { text: 'umowa' }]);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({ documents: [] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/documents?text=umowa');
    expect(documentsInvalidates()).toEqual({ queryKey: ['documents'] });
  });

  it('binds related-document queries and mutations', async () => {
    const otherDocumentId = '55555555-5555-4555-8555-555555555555';
    const link = {
      linkId: '66666666-6666-4666-8666-666666666666',
      label: null,
      draft: true,
      document: { ...document, id: otherDocumentId },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).endsWith('/approve')) {
        return response({
          link: {
            id: link.linkId,
            tenantId: document.tenantId,
            fromDocumentId: document.id,
            toDocumentId: otherDocumentId,
            label: null,
            draft: false,
          },
        });
      }
      if (init?.method === 'POST') return response({ link });
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response({ links: [link] });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const client = newClient();

    await expect(client.fetchQuery(documentLinksQuery(api, document.id))).resolves.toEqual({
      links: [link],
    });
    await expect(
      new MutationObserver(client, linkDocumentsMutation(api)).mutate({
        documentId: document.id,
        input: { otherDocumentId },
      }),
    ).resolves.toEqual({ link });
    await expect(
      new MutationObserver(client, approveDocumentLinkMutation(api)).mutate(link.linkId),
    ).resolves.toMatchObject({ link: { id: link.linkId, draft: false } });
    await expect(
      new MutationObserver(client, unlinkDocumentsMutation(api)).mutate({
        documentId: document.id,
        otherDocumentId,
      }),
    ).resolves.toEqual({ deleted: true });
    expect(documentLinksInvalidates()).toEqual({ queryKey: ['document-links'] });
  });

  it('binds paginated document comment queries and mutations', async () => {
    const first = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-default',
      documentId: document.id,
      author: { accountId: 'user-1', name: 'Owner' },
      body: 'Pierwszy',
      draft: true,
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    const second = {
      ...first,
      id: '66666666-6666-4666-8666-666666666666',
      body: 'Drugi',
      createdAt: '2026-08-16T11:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      if (String(input).endsWith('/approve')) {
        return response({ comment: { ...first, draft: false } });
      }
      if (init?.method === 'POST') return response({ comment: first });
      if (init?.method === 'DELETE') return response({ deleted: true });
      return String(input).includes('cursor=next-page')
        ? response({ items: [second], nextCursor: null })
        : response({ items: [first], nextCursor: 'next-page' });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const client = newClient();

    expect(documentCommentsQuery(api, document.id).queryKey).toEqual([
      'document-comments',
      document.id,
    ]);
    await expect(client.fetchQuery(documentCommentsQuery(api, document.id))).resolves.toEqual({
      items: [first, second],
      nextCursor: null,
    });
    await expect(
      new MutationObserver(client, addDocumentCommentMutation(api)).mutate({
        documentId: document.id,
        input: { body: first.body },
      }),
    ).resolves.toEqual({ comment: first });
    await expect(
      new MutationObserver(client, approveDocumentCommentMutation(api)).mutate(first.id),
    ).resolves.toEqual({ comment: { ...first, draft: false } });
    await expect(
      new MutationObserver(client, deleteDocumentCommentMutation(api)).mutate({
        documentId: document.id,
        commentId: first.id,
      }),
    ).resolves.toEqual({ deleted: true });
    expect(documentCommentsInvalidates(document.id)).toEqual({
      queryKey: ['document-comments', document.id],
    });
  });

  it('binds paginated metadata proposal queries and resolution mutations', async () => {
    const first = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-default',
      documentId: document.id,
      changes: { title: 'Pierwsza' },
      creator: { accountId: 'user-1', name: 'Owner' },
      createdAt: '2026-08-16T10:00:00.000Z',
    };
    const second = {
      ...first,
      id: '66666666-6666-4666-8666-666666666666',
      changes: { person: 'Anna Nowak' },
    };
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      if (String(input).endsWith('/approve')) return response({ document });
      if (String(input).endsWith('/reject')) return response({ deleted: true });
      return String(input).includes('cursor=next-page')
        ? response({ items: [second], nextCursor: null })
        : response({ items: [first], nextCursor: 'next-page' });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const client = newClient();

    await expect(
      client.fetchQuery(documentMetadataProposalsQuery(api, document.id)),
    ).resolves.toEqual({ items: [first, second], nextCursor: null });
    await expect(
      new MutationObserver(client, approveDocumentMetadataProposalMutation(api)).mutate(first.id),
    ).resolves.toEqual({ document });
    await expect(
      new MutationObserver(client, rejectDocumentMetadataProposalMutation(api)).mutate(second.id),
    ).resolves.toEqual({ deleted: true });
    expect(documentMetadataProposalsInvalidates(document.id)).toEqual({
      queryKey: ['document-metadata-proposals', document.id],
    });
  });

  it('executes the detail queryFn and builds identity scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      String(input).endsWith('/api/documents/trash')
        ? response({ documents: [{ ...document, files: [] }] })
        : response({ document: { ...document, files: [] } }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = documentQuery(api, document.id);

    expect(meQuery(api).queryKey).toEqual(['me']);
    expect(query.queryKey).toEqual(['documents', 'detail', document.id]);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({
      document: {
        ...document,
        files: [],
        pendingDrafts: { comments: 0, links: 0, metadataProposals: 0 },
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/api/documents/${document.id}`);

    const trash = trashedDocumentsQuery(api);
    expect(trash.queryKey).toEqual(['documents', 'trash']);
    await expect(newClient().fetchQuery(trash)).resolves.toEqual({
      documents: [{ ...document, files: [] }],
    });
  });

  it('propagates a failed read as ApiError', async () => {
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: () => errorResponse('unauthorized', 'Sign in'),
    });

    await expect(newClient().fetchQuery(documentsQuery(api))).rejects.toMatchObject({
      name: 'ApiError',
      appError: { code: 'unauthorized', message: 'Sign in' },
    });
    await expect(newClient().fetchQuery(documentsQuery(api))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('document mutation descriptors', () => {
  it('executes every surviving mutationFn and unwraps successful API results', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url === 'https://upload.example') return Promise.resolve(new Response(null, { status: 200 }));
      if (url.endsWith('/api/export')) {
        return Promise.resolve(
          new Response('zip', {
            status: 200,
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="documents.zip"',
            },
          }),
        );
      }
      if (url.includes('/files/upload-request')) {
        return response({ upload: { kind: 'server', key: documentFile.storageKey } });
      }
      if (url.includes('/files/finalize') || url.includes('/files/upload?')) {
        return response({ file: documentFile });
      }
      if (url.includes('/files/') && url.endsWith('/move')) {
        return response({ document: { ...document, files: [documentFile] } });
      }
      if (url.endsWith(`/api/documents/${document.id}`) && init?.method === 'PATCH') {
        return response({ outcome: 'updated', document, proposal: null });
      }
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response({ document });
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();
    const observe = <TData, TVariables>(
      descriptor: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
    ) => new MutationObserver(client, descriptor);
    const input = {
      title: document.title,
      docType: document.docType,
      documentDate: document.documentDate,
      periodStart: null,
      periodEnd: null,
    };

    const create = createDocumentMutation(api);
    expect(create.mutationKey).toEqual(['documents', 'create']);
    await expect(observe(create).mutate(input)).resolves.toEqual({ document });
    await expect(
      observe(updateDocumentMutation(api)).mutate({ documentId: document.id, input }),
    ).resolves.toEqual({ outcome: 'updated', document, proposal: null });
    await expect(
      observe(waiveDocumentSignatureMutation(api)).mutate(document.id),
    ).resolves.toEqual({ document });
    await expect(
      observe(requireDocumentSignatureMutation(api)).mutate(document.id),
    ).resolves.toEqual({ document });
    await expect(observe(deleteDocumentMutation(api)).mutate(document.id)).resolves.toEqual({
      deleted: true,
    });
    await expect(observe(restoreDocumentMutation(api)).mutate(document.id)).resolves.toEqual({
      document,
    });
    await expect(observe(purgeDocumentMutation(api)).mutate(document.id)).resolves.toEqual({
      deleted: true,
    });
    await expect(
      observe(requestFileUploadMutation(api)).mutate({
        documentId: document.id,
        input: {
          fileName: documentFile.fileName,
          contentType: documentFile.contentType,
          role: documentFile.role,
        },
      }),
    ).resolves.toEqual({ upload: { kind: 'server', key: documentFile.storageKey } });
    await expect(
      observe(finalizeFileUploadMutation(api)).mutate({
        documentId: document.id,
        input: {
          key: documentFile.storageKey,
          fileName: documentFile.fileName,
          contentType: documentFile.contentType,
          sizeBytes: documentFile.sizeBytes,
          role: documentFile.role,
        },
      }),
    ).resolves.toEqual({ file: documentFile });
    await expect(
      observe(uploadDocumentFileMutation(api)).mutate({
        documentId: document.id,
        input: {
          fileName: documentFile.fileName,
          contentType: documentFile.contentType,
          role: documentFile.role,
          bytes: new Uint8Array([1, 2, 3]),
        },
      }),
    ).resolves.toEqual({ file: documentFile });
    await expect(
      observe(directFileUploadMutation(api)).mutate({
        url: 'https://upload.example',
        method: 'PUT',
        headers: {},
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toBeUndefined();
    await expect(
      observe(deleteDocumentFileMutation(api)).mutate({
        documentId: document.id,
        fileId: documentFile.id,
      }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      observe(moveDocumentFileMutation(api)).mutate({
        documentId: document.id,
        fileId: documentFile.id,
        input: { title: 'Moved', docType: 'protokol' },
      }),
    ).resolves.toEqual({ document: { ...document, files: [documentFile] } });
    await expect(
      observe(exportDocumentsMutation(api)).mutate({ documentIds: [document.id] }),
    ).resolves.toMatchObject({ fileName: 'documents.zip', contentType: 'application/zip' });

    const createRequest = fetchImpl.mock.calls.find(
      ([request, init]) => String(request).endsWith('/api/documents') && init?.method === 'POST',
    );
    expect(createRequest?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(fetchImpl).toHaveBeenCalledTimes(14);
  });

  it('propagates a failed write as ApiError', async () => {
    const api = createApiClient({
      baseUrl: '',
      fetchImpl: () => errorResponse('conflict', 'Already exists'),
    });
    const mutation = new MutationObserver(newClient(), createDocumentMutation(api));

    await expect(
      mutation.mutate({
        title: document.title,
        docType: document.docType,
        documentDate: document.documentDate,
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      appError: { code: 'conflict', message: 'Already exists' },
    });
  });
});

describe('saved search query descriptors', () => {
  it('executes list/create/delete through their own cache scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/saved-searches') && init?.method === 'GET') {
        return response({ savedSearches: [savedSearch] });
      }
      if (url.endsWith('/api/saved-searches') && init?.method === 'POST') {
        return response({ savedSearch });
      }
      return response({ deleted: true });
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();
    const observe = <TData, TVariables>(
      descriptor: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
    ) => new MutationObserver(client, descriptor);

    const list = savedSearchesQuery(api);
    expect(list.queryKey).toEqual(['saved-searches', 'list']);
    await expect(client.fetchQuery(list)).resolves.toEqual({ savedSearches: [savedSearch] });
    expect(savedSearchesInvalidates()).toEqual({ queryKey: ['saved-searches'] });
    await expect(
      observe(createSavedSearchMutation(api)).mutate({
        name: savedSearch.name,
        filter: savedSearch.filter,
      }),
    ).resolves.toEqual({ savedSearch });
    await expect(
      observe(deleteSavedSearchMutation(api)).mutate(savedSearch.id),
    ).resolves.toEqual({ deleted: true });
  });
});

describe('document type query descriptors', () => {
  it('executes list/create/rename/delete and invalidates label consumers', async () => {
    const documentType = {
      slug: 'umowa-z-klientem',
      label: 'Umowa z klientem',
      position: 60,
      hidden: false,
    };
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'GET') return response({ documentTypes: [documentType] });
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response({ documentType });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const client = newClient();
    const observe = <TData, TVariables>(
      descriptor: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
    ) => new MutationObserver(client, descriptor);

    await expect(client.fetchQuery(documentTypesQuery(api))).resolves.toEqual({
      documentTypes: [documentType],
    });
    await expect(
      observe(createDocumentTypeMutation(api)).mutate({ label: documentType.label }),
    ).resolves.toEqual({ documentType });
    await expect(
      observe(renameDocumentTypeMutation(api)).mutate({
        slug: documentType.slug,
        input: { label: 'Kontrakt' },
      }),
    ).resolves.toEqual({ documentType });
    await expect(
      observe(deleteDocumentTypeMutation(api)).mutate(documentType.slug),
    ).resolves.toEqual({ deleted: true });
    await expect(
      observe(setDocumentTypeHiddenMutation(api)).mutate({
        slug: documentType.slug,
        input: { hidden: true },
      }),
    ).resolves.toEqual({ documentType });
    expect(documentTypesInvalidates()).toEqual([
      { queryKey: ['document-types'] },
      { queryKey: ['documents'] },
      { queryKey: ['saved-searches'] },
    ]);
  });
});

describe('hidden filter value query descriptors', () => {
  it('executes list/hide/unhide and invalidates the suggestion sources', async () => {
    const hiddenFilterValue = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'tenant-default',
      kind: 'person' as const,
      value: 'Jan Kowalski',
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (init?.method === 'GET') return response({ hiddenFilterValues: [hiddenFilterValue] });
      return String(input).endsWith('/unhide')
        ? response({ unhidden: true })
        : response({ hiddenFilterValue });
    });
    const api = createApiClient({ baseUrl: '', fetchImpl });
    const client = newClient();
    const observe = <TData, TVariables>(
      descriptor: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
    ) => new MutationObserver(client, descriptor);

    const list = hiddenFilterValuesQuery(api);
    expect(list.queryKey).toEqual(['hidden-filter-values', 'list']);
    await expect(client.fetchQuery(list)).resolves.toEqual({
      hiddenFilterValues: [hiddenFilterValue],
    });
    await expect(
      observe(hideFilterValueMutation(api)).mutate({ kind: 'person', value: 'Jan Kowalski' }),
    ).resolves.toEqual({ hiddenFilterValue });
    await expect(
      observe(unhideFilterValueMutation(api)).mutate({ kind: 'person', value: 'Jan Kowalski' }),
    ).resolves.toEqual({ unhidden: true });
    expect(hiddenFilterValuesInvalidates()).toEqual([
      { queryKey: ['hidden-filter-values'] },
      { queryKey: ['documents'] },
    ]);
  });
});

describe('api token query descriptors', () => {
  it('executes list/create/revoke through their own cache scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/api-tokens') && init?.method === 'GET') {
        return response({ apiTokens: [apiToken] });
      }
      if (url.endsWith('/api/api-tokens') && init?.method === 'POST') {
        return response({ apiToken, value: 'pat_secret' });
      }
      return response({ revoked: true });
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();
    const observe = <TData, TVariables>(
      descriptor: ConstructorParameters<typeof MutationObserver<TData, Error, TVariables>>[1],
    ) => new MutationObserver(client, descriptor);

    const list = apiTokensQuery(api);
    expect(list.queryKey).toEqual(['api-tokens', 'list']);
    await expect(client.fetchQuery(list)).resolves.toEqual({ apiTokens: [apiToken] });
    expect(apiTokensInvalidates()).toEqual({ queryKey: ['api-tokens'] });
    await expect(
      observe(createApiTokenMutation(api)).mutate({
        name: apiToken.name,
        scopes: ['write:draft'],
      }),
    ).resolves.toEqual({ apiToken, value: 'pat_secret' });
    await expect(
      observe(revokeApiTokenMutation(api)).mutate(apiToken.id),
    ).resolves.toEqual({ revoked: true });
  });
});

describe('user preference query descriptors', () => {
  it('executes get/set through the preference cache scope', async () => {
    const preference = {
      userId: 'user-1',
      key: 'documents.columns',
      value: { order: ['title'], visible: ['title'] },
      updatedAt: '2026-08-02T10:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>((input, init) =>
      init?.method === 'PUT'
        ? response({ preference })
        : response({ preference: null }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();

    const query = userPreferenceQuery(api, 'documents.columns');
    expect(query.queryKey).toEqual(['user-preferences', 'documents.columns']);
    await expect(client.fetchQuery(query)).resolves.toEqual({ preference: null });
    expect(userPreferenceInvalidates('documents.columns')).toEqual({
      queryKey: ['user-preferences', 'documents.columns'],
    });
    await expect(
      new MutationObserver(client, setUserPreferenceMutation(api)).mutate({
        key: 'documents.columns',
        input: { value: { order: ['title'], visible: ['title'] } },
      }),
    ).resolves.toEqual({ preference });
  });
});

describe('tenant settings and signature record descriptors', () => {
  it('executes reads and writes through resource cache scopes', async () => {
    const record = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-default',
      documentId: document.id,
      fileId: documentFile.id,
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
    const nextRecord = {
      ...record,
      id: '77777777-7777-4777-8777-777777777777',
      createdAt: '2026-08-07T11:00:00.000Z',
    };
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tenant-settings')) {
        return response({
          settings: {
            tenantId: 'tenant-default',
            storeSignatureRecords: init?.method === 'GET',
            pdfSealEnabled: init?.method !== 'GET',
            signatureBoxEnabled: init?.method !== 'GET',
            dateMode: init?.method === 'GET' ? 'declared' : 'actual',
          },
        });
      }
      if (init?.method !== 'GET') return response({ signatureRecord: record });
      return url.includes('cursor=next-page')
        ? response({ items: [nextRecord], nextCursor: null })
        : response({ items: [record], nextCursor: 'next-page' });
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();

    expect(tenantSettingsQuery(api).queryKey).toEqual(['tenant-settings']);
    await expect(client.fetchQuery(tenantSettingsQuery(api))).resolves.toMatchObject({
      settings: { storeSignatureRecords: true, pdfSealEnabled: false, signatureBoxEnabled: false, dateMode: 'declared' },
    });
    await expect(
      new MutationObserver(client, updateTenantSettingsMutation(api)).mutate({
        storeSignatureRecords: false,
      }),
    ).resolves.toMatchObject({
      settings: { storeSignatureRecords: false, pdfSealEnabled: true, signatureBoxEnabled: true, dateMode: 'actual' },
    });
    expect(tenantSettingsInvalidates()).toEqual({ queryKey: ['tenant-settings'] });

    expect(signatureRecordsQuery(api, document.id).queryKey).toEqual([
      'signature-records',
      document.id,
    ]);
    await expect(client.fetchQuery(signatureRecordsQuery(api, document.id))).resolves.toEqual({
      items: [record, nextRecord],
      nextCursor: null,
    });
    await expect(
      new MutationObserver(client, createSignatureRecordMutation(api)).mutate({
        documentId: document.id,
        input: { fileId: documentFile.id, payload: record.payload },
      }),
    ).resolves.toMatchObject({
      signatureRecord: { id: record.id, fileId: record.fileId, payload: record.payload },
    });
    expect(signatureRecordsInvalidates(document.id)).toEqual({
      queryKey: ['signature-records', document.id],
    });
  });

  it('propagates an error from a later signature-record page', async () => {
    let page = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      page += 1;
      return page === 1
        ? response({ items: [], nextCursor: 'next-page' })
        : errorResponse('unauthorized', 'Sign in');
    });
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });

    await expect(
      newClient().fetchQuery(signatureRecordsQuery(api, document.id)),
    ).rejects.toMatchObject({
      name: 'ApiError',
      appError: { code: 'unauthorized', message: 'Sign in' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('tenant account query descriptors', () => {
  it('executes the tenant account list through its cache scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      response({ accounts: [{ accountId: 'account-1', name: 'Maria Choma' }] }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = tenantAccountsQuery(api);

    expect(query.queryKey).toEqual(['tenant-accounts']);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({
      accounts: [{ accountId: 'account-1', name: 'Maria Choma' }],
    });
  });
});

describe('source update request descriptors', () => {
  it('executes document, notification, and state transition calls', async () => {
    const request = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: 'tenant-default',
      documentId: document.id,
      requestedBy: 'user-owner',
      newSourceFileId: documentFile.id,
      mode: 'transfer' as const,
      status: 'pending' as const,
      approvals: [],
    };
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      String(input).endsWith('/pending')
        ? response({ requests: [request] })
        : response({ request }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const client = newClient();

    await expect(
      client.fetchQuery(activeSourceUpdateRequestQuery(api, document.id)),
    ).resolves.toEqual({ request });
    await expect(
      client.fetchQuery(pendingSourceUpdateRequestsQuery(api)),
    ).resolves.toEqual({ requests: [request] });
    await expect(
      new MutationObserver(client, createSourceUpdateRequestMutation(api)).mutate({
        documentId: document.id,
        input: { newSourceFileId: documentFile.id, mode: 'transfer' },
      }),
    ).resolves.toEqual({ request });
    await expect(
      new MutationObserver(client, decideSourceUpdateRequestMutation(api)).mutate({
        requestId: request.id,
        input: { decision: 'accept' },
      }),
    ).resolves.toEqual({ request });
    await expect(
      new MutationObserver(client, cancelSourceUpdateRequestMutation(api)).mutate(
        request.id,
      ),
    ).resolves.toEqual({ request });
    await expect(
      new MutationObserver(client, completeSourceUpdateRequestMutation(api)).mutate({
        requestId: request.id,
        input: { signedFileId: documentFile.id },
      }),
    ).resolves.toEqual({ request });
    expect(sourceUpdateRequestsInvalidates()).toEqual({
      queryKey: ['source-update-requests'],
    });
  });
});

type AuthWrite<T> = Promise<Result<T, AppError>>;

const auth: AuthClientPort = {
  signUp: async (): AuthWrite<AuthSessionResult> => ok({ token: 'signed-up' }),
  signIn: async (): AuthWrite<AuthSessionResult> => ok({ token: 'signed-in' }),
  signOut: async (): AuthWrite<void> => ok(undefined),
  updateUser: async (): AuthWrite<void> => ok(undefined),
  changePassword: async (): AuthWrite<void> => ok(undefined),
  requestMagicLink: async (): AuthWrite<void> => ok(undefined),
  requestPasswordReset: async (): AuthWrite<void> => ok(undefined),
  resetPassword: async (): AuthWrite<void> => ok(undefined),
  signInSocial: async () => ok({ url: 'https://accounts.example/auth' }),
  enableTwoFactor: async () => ok({ totpURI: 'otpauth://totp/demo', backupCodes: [] }),
  verifyTotp: async (): AuthWrite<AuthSessionResult> => ok({ token: 'verified' }),
  disableTwoFactor: async (): AuthWrite<void> => ok(undefined),
  registerPasskey: async (): AuthWrite<void> => ok(undefined),
  listPasskeys: async (): Promise<Result<PasskeyInfo[], AppError>> => ok([]),
  removePasskey: async (): AuthWrite<void> => ok(undefined),
  signInPasskey: async (): AuthWrite<AuthSessionResult> => ok({ token: 'passkey' }),
};

describe('auth mutation descriptors', () => {
  it('executes profile and password mutations through AuthClientPort', async () => {
    const client = newClient();
    await expect(
      new MutationObserver(client, updateUserMutation(auth)).mutate({
        name: 'Maria Kowalska',
      }),
    ).resolves.toBeUndefined();
    await expect(
      new MutationObserver(client, changePasswordMutation(auth)).mutate({
        currentPassword: 'demo1234',
        newPassword: 'changed1234',
        revokeOtherSessions: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      new MutationObserver(client, requestPasswordResetMutation(auth)).mutate({
        email: 'demo@example.com',
        redirectTo: 'https://podpisy.example/reset-password',
      }),
    ).resolves.toBeUndefined();
    await expect(
      new MutationObserver(client, resetPasswordMutation(auth)).mutate({
        token: 'reset-token',
        newPassword: 'changed1234',
      }),
    ).resolves.toBeUndefined();
  });
});
