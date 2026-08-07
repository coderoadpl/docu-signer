import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

import { err, internal, ok } from '#core/domain/index.js';

import type { AuthClientPort } from './auth-port.js';
import { ApiError, type ApiClient } from './http.js';
import {
  addTodoInvalidates,
  addTodoMutation,
  createDocumentMutation,
  createTenantMutation,
  deleteDocumentMutation,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  documentsScopes,
  finalizeFileUploadMutation,
  meQuery,
  meScopes,
  removeFileMutation,
  requestFileUploadMutation,
  serverUploadMutation,
  signInMutation,
  signOutMutation,
  signUpMutation,
  tenantsQuery,
  tenantsScopes,
  todosQuery,
  todosScopes,
  updateDocumentMutation,
} from './queries.js';

const todo = {
  id: 'todo-1',
  tenantId: 't-acme',
  title: 'Ship it',
  createdBy: 'u1',
  createdAt: '2026-07-03T00:00:00.000Z',
};

const tenant = { id: 't-acme', slug: 'acme', name: 'Acme Inc' };

const document = {
  id: 'document-1',
  tenantId: 't-acme',
  title: 'Agreement',
  docType: 'umowa-uod' as const,
  documentDate: '2026-07-18',
  tags: [],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const file = {
  id: 'file-1',
  documentId: document.id,
  role: 'source' as const,
  fileName: 'source.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1,
  storageKey: 'key',
  createdAt: '2026-07-18T00:00:00.000Z',
};

const happyApi: ApiClient = {
  health: async () => ok({ status: 'ok', version: '0.1.0', database: 'up' }),
  me: async () => ok({ userId: 'u1', email: 'demo@example.com', name: 'Demo', tenant: null }),
  listTenants: async () => ok({ tenants: [{ tenant, staffRole: 'owner' }] }),
  createTenant: async (input) => ok({ tenant: { id: 't-new', slug: input.slug, name: input.name } }),
  listTodos: async () => ok({ todos: [todo] }),
  addTodo: async (input) => ok({ todo: { ...todo, title: input.title } }),
  listDocuments: async () => ok({ documents: [{ ...document, files: [file] }] }),
  createDocument: async (input) => ok({ document: { ...document, ...input, tags: input.tags ?? [] } }),
  getDocument: async () => ok({ document: { ...document, files: [file] } }),
  updateDocument: async (_documentId, input) => ok({ document: { ...document, ...input, tags: input.tags ?? [] } }),
  deleteDocument: async () => ok({ deleted: true }),
  requestFileUpload: async () => ok({ upload: { kind: 'server', key: 'key' } }),
  finalizeFileUpload: async () => ok({ file }),
  serverUpload: async () => ok({ file }),
  removeFile: async () => ok({ deleted: true }),
  fileContentUrl: () => '/content',
  directFileUpload: async () => ok(undefined),
};

const sadApi: ApiClient = {
  health: async () => err(internal('boom')),
  me: async () => err({ code: 'unauthorized', message: 'Login required' }),
  listTenants: async () => err(internal('boom')),
  createTenant: async () => err({ code: 'conflict', message: 'Already exists' }),
  listTodos: async () => err(internal('boom')),
  addTodo: async () => err(internal('boom')),
  listDocuments: async () => err(internal('boom')),
  createDocument: async () => err(internal('boom')),
  getDocument: async () => err(internal('boom')),
  updateDocument: async () => err(internal('boom')),
  deleteDocument: async () => err(internal('boom')),
  requestFileUpload: async () => err(internal('boom')),
  finalizeFileUpload: async () => err(internal('boom')),
  serverUpload: async () => err(internal('boom')),
  removeFile: async () => err(internal('boom')),
  fileContentUrl: () => '/content',
  directFileUpload: async () => err(internal('boom')),
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('query descriptors', () => {
  it('carry the resource scope as their query key', () => {
    expect(meQuery(happyApi).queryKey).toEqual(meScopes.all());
    expect(tenantsQuery(happyApi).queryKey).toEqual(tenantsScopes.all());
    expect(todosQuery(happyApi).queryKey).toEqual(todosScopes.lists());
    expect(documentsQuery(happyApi, { docType: 'umowa-uod' }).queryKey).toEqual(
      documentsScopes.list({ docType: 'umowa-uod' }),
    );
    expect(documentQuery(happyApi, document.id).queryKey).toEqual(documentsScopes.detail(document.id));
    expect(documentsScopes.lists()).toEqual(['documents', 'list']);
    expect(documentsScopes.details()).toEqual(['documents', 'detail']);
  });

  it('unwrap the Result value through the queryFn on success', async () => {
    const client = newClient();

    await expect(client.fetchQuery(meQuery(happyApi))).resolves.toEqual({
      userId: 'u1',
      email: 'demo@example.com',
      name: 'Demo',
      tenant: null,
    });
    await expect(client.fetchQuery(tenantsQuery(happyApi))).resolves.toEqual({
      tenants: [{ tenant, staffRole: 'owner' }],
    });
    await expect(client.fetchQuery(todosQuery(happyApi))).resolves.toEqual({ todos: [todo] });
    await expect(client.fetchQuery(documentsQuery(happyApi))).resolves.toEqual({
      documents: [{ ...document, files: [file] }],
    });
    await expect(client.fetchQuery(documentQuery(happyApi, document.id))).resolves.toEqual({
      document: { ...document, files: [file] },
    });
  });

  it('throw an ApiError carrying the AppError when the call fails', async () => {
    const client = newClient();

    await expect(client.fetchQuery(meQuery(sadApi))).rejects.toBeInstanceOf(ApiError);
    await expect(client.fetchQuery(meQuery(sadApi))).rejects.toMatchObject({
      appError: { code: 'unauthorized' },
    });
  });
});

describe('mutation descriptors', () => {
  it('carry a create-suffixed mutation key', () => {
    expect(createTenantMutation(happyApi).mutationKey).toEqual([...tenantsScopes.all(), 'create']);
    expect(addTodoMutation(happyApi).mutationKey).toEqual([...todosScopes.all(), 'create']);
  });

  it('unwrap the write Result through the mutationFn on success', async () => {
    const client = newClient();

    await expect(
      new MutationObserver(client, createTenantMutation(happyApi)).mutate({ slug: 'new-co', name: 'New Co' }),
    ).resolves.toEqual({ tenant: { id: 't-new', slug: 'new-co', name: 'New Co' } });

    await expect(
      new MutationObserver(client, addTodoMutation(happyApi)).mutate({ title: 'Ship it' }),
    ).resolves.toEqual({ todo: { ...todo, title: 'Ship it' } });
  });

  it('executes every document mutation descriptor', async () => {
    const client = newClient();
    const input = { title: 'Agreement', docType: 'umowa-uod' as const, documentDate: '2026-07-18' };
    await new MutationObserver(client, createDocumentMutation(happyApi)).mutate(input);
    await new MutationObserver(client, updateDocumentMutation(happyApi)).mutate({ documentId: document.id, input });
    await new MutationObserver(client, deleteDocumentMutation(happyApi)).mutate(document.id);
    await new MutationObserver(client, requestFileUploadMutation(happyApi)).mutate({
      documentId: document.id,
      input: { fileName: 'source.pdf', contentType: 'application/pdf', role: 'source' },
    });
    await new MutationObserver(client, finalizeFileUploadMutation(happyApi)).mutate({
      documentId: document.id,
      input: { key: 'key', fileName: 'source.pdf', contentType: 'application/pdf', sizeBytes: 1, role: 'source' },
    });
    await new MutationObserver(client, serverUploadMutation(happyApi)).mutate({
      documentId: document.id,
      input: { fileName: 'source.pdf', contentType: 'application/pdf', role: 'source', bytes: new Uint8Array([1]) },
    });
    await new MutationObserver(client, removeFileMutation(happyApi)).mutate({
      documentId: document.id,
      fileId: file.id,
    });
  });

  it('throw an ApiError from the mutationFn when the call fails', async () => {
    const client = newClient();

    await expect(
      new MutationObserver(client, createTenantMutation(sadApi)).mutate({ slug: 'acme', name: 'Dup' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('invalidates the todo lists after a successful add', () => {
    expect(addTodoInvalidates()).toEqual({ queryKey: todosScopes.lists() });
    expect(documentsInvalidates()).toEqual({ queryKey: documentsScopes.all() });
  });
});

const fakeAuth = (): AuthClientPort => ({
  signUp: async () => ok({ token: 'signed-up' }),
  signIn: async () => ok({ token: 'signed-in' }),
  signOut: async () => ok(undefined),
});

describe('auth mutation descriptors', () => {
  it('wrap each auth side effect as a mutation over the port', async () => {
    const client = newClient();
    const auth = fakeAuth();

    await expect(
      new MutationObserver(client, signUpMutation(auth)).mutate({
        name: 'Demo',
        email: 'demo@example.com',
        password: 'demo1234',
      }),
    ).resolves.toEqual({ token: 'signed-up' });
    await expect(
      new MutationObserver(client, signInMutation(auth)).mutate({ email: 'demo@example.com', password: 'demo1234' }),
    ).resolves.toEqual({ token: 'signed-in' });
    await expect(
      new MutationObserver(client, signOutMutation(auth)).mutate(),
    ).resolves.toBeUndefined();
  });

  it('propagate port failures as ApiError', async () => {
    const client = newClient();
    const auth: AuthClientPort = {
      ...fakeAuth(),
      signIn: async () => err({ code: 'unauthorized', message: 'Bad credentials' }),
    };

    await expect(
      new MutationObserver(client, signInMutation(auth)).mutate({ email: 'demo@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
