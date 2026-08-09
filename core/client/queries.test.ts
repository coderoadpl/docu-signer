import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './http.js';
import {
  changePasswordMutation,
  createDocumentMutation,
  createSavedSearchMutation,
  deleteDocumentFileMutation,
  deleteDocumentMutation,
  deleteSavedSearchMutation,
  directFileUploadMutation,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  exportDocumentsMutation,
  finalizeFileUploadMutation,
  meQuery,
  moveDocumentFileMutation,
  requestPasswordResetMutation,
  resetPasswordMutation,
  requestFileUploadMutation,
  savedSearchesInvalidates,
  savedSearchesQuery,
  updateDocumentMutation,
  uploadDocumentFileMutation,
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
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
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

const response = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200 }));

const errorResponse = (code: 'conflict' | 'unauthorized', message: string) =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: false, error: { code, message } }), { status: 400 }),
  );

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('document query descriptors', () => {
  it('executes the list queryFn and unwraps its API result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => response({ documents: [] }));
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = documentsQuery(api, { text: 'umowa' });

    expect(query.queryKey).toEqual(['documents', 'list', { text: 'umowa' }]);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({ documents: [] });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/documents?text=umowa');
    expect(documentsInvalidates()).toEqual({ queryKey: ['documents'] });
  });

  it('executes the detail queryFn and builds identity scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      response({ document: { ...document, files: [] } }),
    );
    const api = createApiClient({ baseUrl: 'https://archive.example', fetchImpl });
    const query = documentQuery(api, document.id);

    expect(meQuery(api).queryKey).toEqual(['me']);
    expect(query.queryKey).toEqual(['documents', 'detail', document.id]);
    await expect(newClient().fetchQuery(query)).resolves.toEqual({
      document: { ...document, files: [] },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/api/documents/${document.id}`);
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
    ).resolves.toEqual({ document });
    await expect(observe(deleteDocumentMutation(api)).mutate(document.id)).resolves.toEqual({
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
    expect(fetchImpl).toHaveBeenCalledTimes(10);
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

type AuthWrite<T> = Promise<Result<T, AppError>>;

const auth: AuthClientPort = {
  signUp: async (): AuthWrite<AuthSessionResult> => ok({ token: 'signed-up' }),
  signIn: async (): AuthWrite<AuthSessionResult> => ok({ token: 'signed-in' }),
  signOut: async (): AuthWrite<void> => ok(undefined),
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
  it('executes password change and reset mutations through AuthClientPort', async () => {
    const client = newClient();
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
