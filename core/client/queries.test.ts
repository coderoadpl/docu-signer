import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

import { err, internal, ok } from '#core/domain/index.js';

import type { AuthClientPort } from './auth-port.js';
import { ApiError, type ApiClient } from './http.js';
import {
  addCardMutation,
  addTodoInvalidates,
  addTodoMutation,
  cardsInvalidates,
  cardsQuery,
  cardsScopes,
  createTenantMutation,
  ensureMemberInvalidates,
  ensureMemberMutation,
  membersQuery,
  membersScopes,
  meQuery,
  meScopes,
  moveCardMutation,
  passkeysQuery,
  registerPasskeyMutation,
  removePasskeyMutation,
  signInMutation,
  signInPasskeyMutation,
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

const card = {
  id: 'card-1',
  tenantId: 't-acme',
  title: 'Card one',
  board: 'personal' as const,
  column: 'todo',
  position: 0,
  visited: ['todo'],
  createdAt: '2026-07-03T00:00:00.000Z',
};

const tenant = { id: 't-acme', slug: 'acme', name: 'Acme Inc' };

const member = {
  id: 'member-1',
  tenantId: 't-acme',
  userId: null,
  email: 'alice@example.com',
  displayName: 'Alice',
  tags: ['vip'],
  marketingConsents: [],
  externalCustomerIds: [],
  createdAt: '2026-07-03T00:00:00.000Z',
  lastSeenAt: null,
};

const happyApi: ApiClient = {
  health: async () => ok({ status: 'ok', version: '0.1.0', sha: 'test-sha', database: 'up' }),
  healthLive: async () => ok({ status: 'ok', version: '0.1.0', sha: 'test-sha' }),
  healthReady: async () => ok({ status: 'ok', version: '0.1.0', sha: 'test-sha', database: 'up' }),
  config: async () => ok({ googleEnabled: false }),
  me: async () => ok({ userId: 'u1', email: 'demo@example.com', name: 'Demo', tenant: null }),
  listTenants: async () => ok({ tenants: [{ tenant, staffRole: 'owner' }] }),
  createTenant: async (input) => ok({ tenant: { id: 't-new', slug: input.slug, name: input.name } }),
  listTodos: async () => ok({ todos: [todo] }),
  addTodo: async (input) => ok({ todo: { ...todo, title: input.title } }),
  listCards: async () => ok({ cards: [card] }),
  addCard: async (input) => ok({ card: { ...card, title: input.title, column: input.column } }),
  moveCard: async (input) => ok({ card: { ...card, column: input.toColumn, position: input.toIndex } }),
  listMembers: async () => ok({ members: [member] }),
  ensureMember: async (input) => ok({ member: { ...member, email: input.email }, created: true }),
  updateMember: async (input) => ok({ member: { ...member, id: input.id } }),
  removeMember: async (input) => ok({ memberId: input.id, deleted: { members: 1 } }),
  exportMember: async (id) => ok({ exportedAt: '2026-07-10T00:00:00.000Z', tenantId: 't-acme', member: { ...member, id } }),
  listStaff: async () => ok({ staff: [{ id: 'g-1', userId: 'u1', email: 'demo@example.com', name: 'Demo', role: 'owner' }] }),
  grantStaff: async (input) => ok({ staff: { id: 'g-new', userId: 'u-new', email: input.email, name: 'New', role: 'admin' }, granted: true }),
  revokeStaff: async (input) => ok({ userId: input.userId ?? 'u-x', revoked: 1 }),
  listDomains: async () =>
    ok({
      domains: [{ id: 'd-1', tenantId: 't-acme', domain: 'shop.acme.com', kind: 'custom', verified: true }],
      target: { cname: 'apps.example.com', ip: null },
    }),
  addDomain: async (input) =>
    ok({ domain: { id: 'd-new', tenantId: 't-acme', domain: input.domain, kind: 'custom', verified: false } }),
  checkDomain: async (input) =>
    ok({
      domain: { id: 'd-1', tenantId: 't-acme', domain: input.domain, kind: 'custom', verified: true },
      check: { resolved: true, detail: 'ok' },
    }),
  removeDomain: async (input) => ok({ domain: input.domain, removed: 1 }),
  publicTenantDiscovery: async (slug) => ok({ slug, contentVersion: 'v1' }),
  publicTenantProfile: async (slug) => ok({ slug, displayName: 'Acme Inc', contentVersion: 'v1' }),
};

const sadApi: ApiClient = {
  health: async () => err(internal('boom')),
  healthLive: async () => err(internal('boom')),
  healthReady: async () => err({ code: 'unavailable', message: 'db down' }),
  me: async () => err({ code: 'unauthorized', message: 'Login required' }),
  listTenants: async () => err(internal('boom')),
  createTenant: async () => err({ code: 'conflict', message: 'Already exists' }),
  config: async () => err(internal('boom')),
  listTodos: async () => err(internal('boom')),
  addTodo: async () => err(internal('boom')),
  listCards: async () => err(internal('boom')),
  addCard: async () => err(internal('boom')),
  moveCard: async () => err(internal('boom')),
  listMembers: async () => err(internal('boom')),
  ensureMember: async () => err(internal('boom')),
  updateMember: async () => err(internal('boom')),
  removeMember: async () => err(internal('boom')),
  exportMember: async () => err(internal('boom')),
  listStaff: async () => err(internal('boom')),
  grantStaff: async () => err(internal('boom')),
  revokeStaff: async () => err(internal('boom')),
  listDomains: async () => err(internal('boom')),
  addDomain: async () => err(internal('boom')),
  checkDomain: async () => err(internal('boom')),
  removeDomain: async () => err(internal('boom')),
  publicTenantDiscovery: async () => err(internal('boom')),
  publicTenantProfile: async () => err(internal('boom')),
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('query descriptors', () => {
  it('carry the resource scope as their query key', () => {
    expect(meQuery(happyApi).queryKey).toEqual(meScopes.all());
    expect(tenantsQuery(happyApi).queryKey).toEqual(tenantsScopes.all());
    expect(todosQuery(happyApi).queryKey).toEqual(todosScopes.lists());
    expect(cardsQuery(happyApi).queryKey).toEqual(cardsScopes.list('personal'));
    expect(membersQuery(happyApi).queryKey).toEqual(membersScopes.lists());
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
    await expect(client.fetchQuery(cardsQuery(happyApi))).resolves.toEqual({ cards: [card] });
    await expect(client.fetchQuery(membersQuery(happyApi))).resolves.toEqual({ members: [member] });
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
    expect(addCardMutation(happyApi).mutationKey).toEqual([...cardsScopes.all(), 'create']);
    expect(moveCardMutation(happyApi).mutationKey).toEqual([...cardsScopes.all(), 'move']);
    expect(ensureMemberMutation(happyApi).mutationKey).toEqual([...membersScopes.all(), 'ensure']);
    expect(ensureMemberInvalidates()).toEqual({ queryKey: membersScopes.lists() });
  });

  it('unwrap the write Result through the mutationFn on success', async () => {
    const client = newClient();

    await expect(
      new MutationObserver(client, createTenantMutation(happyApi)).mutate({ slug: 'new-co', name: 'New Co' }),
    ).resolves.toEqual({ tenant: { id: 't-new', slug: 'new-co', name: 'New Co' } });

    await expect(
      new MutationObserver(client, addTodoMutation(happyApi)).mutate({ title: 'Ship it' }),
    ).resolves.toEqual({ todo: { ...todo, title: 'Ship it' } });

    await expect(
      new MutationObserver(client, addCardMutation(happyApi)).mutate({ title: 'New card', column: 'doing' }),
    ).resolves.toEqual({ card: { ...card, title: 'New card', column: 'doing' } });

    await expect(
      new MutationObserver(client, moveCardMutation(happyApi)).mutate({ cardId: 'card-1', toColumn: 'done', toIndex: 2 }),
    ).resolves.toEqual({ card: { ...card, column: 'done', position: 2 } });

    await expect(
      new MutationObserver(client, ensureMemberMutation(happyApi)).mutate({ email: 'bob@example.com' }),
    ).resolves.toEqual({ member: { ...member, email: 'bob@example.com' }, created: true });
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

  it('invalidates the card lists after a successful add or move', () => {
    expect(cardsInvalidates()).toEqual({ queryKey: cardsScopes.lists() });
  });
});

const fakeAuth = (): AuthClientPort => ({
  signUp: async () => ok({ token: 'signed-up' }),
  signIn: async () => ok({ token: 'signed-in' }),
  signOut: async () => ok(undefined),
  requestMagicLink: async () => ok(undefined),
  signInSocial: async () => ok({ url: 'https://accounts.google.example/authorize' }),
  enableTwoFactor: async () => ok({ totpURI: 'otpauth://totp/demo', backupCodes: ['aaaa-bbbb'] }),
  verifyTotp: async () => ok(undefined),
  disableTwoFactor: async () => ok(undefined),
  registerPasskey: async () => ok(undefined),
  listPasskeys: async () => ok([{ id: 'pk-1', name: 'Laptop', createdAt: '2026-07-03T00:00:00.000Z' }]),
  removePasskey: async () => ok(undefined),
  signInPasskey: async () => ok({ token: null }),
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

describe('passkey descriptors', () => {
  it('read the roster through a query and wrap register/remove/sign-in as commands', async () => {
    const client = newClient();
    const auth = fakeAuth();

    await expect(client.fetchQuery(passkeysQuery(auth))).resolves.toEqual([
      { id: 'pk-1', name: 'Laptop', createdAt: '2026-07-03T00:00:00.000Z' },
    ]);
    await expect(
      new MutationObserver(client, registerPasskeyMutation(auth)).mutate({ name: 'Laptop' }),
    ).resolves.toBeUndefined();
    await expect(
      new MutationObserver(client, removePasskeyMutation(auth)).mutate({ id: 'pk-1' }),
    ).resolves.toBeUndefined();
    await expect(
      new MutationObserver(client, signInPasskeyMutation(auth)).mutate(),
    ).resolves.toEqual({ token: null });
  });

  it('propagate a passkey list failure as ApiError', async () => {
    const client = newClient();
    const auth: AuthClientPort = {
      ...fakeAuth(),
      listPasskeys: async () => err(internal('boom')),
    };

    await expect(client.fetchQuery(passkeysQuery(auth))).rejects.toBeInstanceOf(ApiError);
  });
});
