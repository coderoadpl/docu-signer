import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

import { err, internal, ok } from '#core/domain/index.js';

import type { AuthClientPort } from './auth-port.js';
import { ApiError, type ApiClient } from './http.js';
import {
  addTodoInvalidates,
  addTodoMutation,
  createTenantMutation,
  meQuery,
  meScopes,
  signInMutation,
  signOutMutation,
  signUpMutation,
  tenantsQuery,
  tenantsScopes,
  todosQuery,
  todosScopes,
} from './queries.js';

const todo = {
  id: 'todo-1',
  tenantId: 't-acme',
  title: 'Ship it',
  createdBy: 'u1',
  createdAt: '2026-07-03T00:00:00.000Z',
};

const tenant = { id: 't-acme', slug: 'acme', name: 'Acme Inc' };

const happyApi: ApiClient = {
  health: async () => ok({ status: 'ok', version: '0.1.0', database: 'up' }),
  me: async () => ok({ userId: 'u1', email: 'demo@example.com', name: 'Demo', tenant: null }),
  listTenants: async () => ok({ tenants: [{ tenant, staffRole: 'owner' }] }),
  createTenant: async (input) => ok({ tenant: { id: 't-new', slug: input.slug, name: input.name } }),
  listTodos: async () => ok({ todos: [todo] }),
  addTodo: async (input) => ok({ todo: { ...todo, title: input.title } }),
};

const sadApi: ApiClient = {
  health: async () => err(internal('boom')),
  me: async () => err({ code: 'unauthorized', message: 'Login required' }),
  listTenants: async () => err(internal('boom')),
  createTenant: async () => err({ code: 'conflict', message: 'Already exists' }),
  listTodos: async () => err(internal('boom')),
  addTodo: async () => err(internal('boom')),
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('query descriptors', () => {
  it('carry the resource scope as their query key', () => {
    expect(meQuery(happyApi).queryKey).toEqual(meScopes.all());
    expect(tenantsQuery(happyApi).queryKey).toEqual(tenantsScopes.all());
    expect(todosQuery(happyApi).queryKey).toEqual(todosScopes.lists());
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

  it('throw an ApiError from the mutationFn when the call fails', async () => {
    const client = newClient();

    await expect(
      new MutationObserver(client, createTenantMutation(sadApi)).mutate({ slug: 'acme', name: 'Dup' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('invalidates the todo lists after a successful add', () => {
    expect(addTodoInvalidates()).toEqual({ queryKey: todosScopes.lists() });
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
