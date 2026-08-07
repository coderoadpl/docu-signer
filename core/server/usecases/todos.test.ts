import { describe, expect, it } from 'vitest';

import type { Identity, Todo } from '#core/domain/index.js';

import type { TodoRepository } from '../ports.js';
import { addTodo, listTodos } from './todos.js';

const identity = (tenantId: string | null): Identity => ({
  userId: 'u1',
  email: 'demo@example.com',
  name: 'Demo',
  tenantId,
  tenantSlug: tenantId ? 'acme' : null,
  tenantName: tenantId ? 'Acme Inc' : null,
  staffRole: tenantId ? 'owner' : null,
  memberId: null,
});

const fakeRepo = (initial: Todo[] = []) => {
  const store = [...initial];
  const repo: TodoRepository = {
    listByTenant: async (tenantId) => store.filter((t) => t.tenantId === tenantId),
    create: async (todo) => {
      store.push(todo);
    },
  };
  return { repo, store };
};

const deps = (repo: TodoRepository) => ({
  todos: repo,
  ids: { nextId: () => 'todo-1' },
  clock: { nowIso: () => '2026-07-03T00:00:00.000Z' },
});

describe('todos use-cases', () => {
  it('scopes listing to the tenant in ctx', async () => {
    const { repo } = fakeRepo([
      { id: '1', tenantId: 't-acme', title: 'a', createdBy: 'u1', createdAt: 'x' },
      { id: '2', tenantId: 't-globex', title: 'b', createdBy: 'u1', createdAt: 'x' },
    ]);
    const result = await listTodos({ identity: identity('t-acme') }, deps(repo));
    expect(result.ok && result.value.map((t) => t.id)).toEqual(['1']);
  });

  it('refuses to operate without a tenant', async () => {
    const { repo } = fakeRepo();
    const listed = await listTodos({ identity: identity(null) }, deps(repo));
    expect(listed).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });

    const added = await addTodo({ identity: identity(null) }, { title: 'x' }, deps(repo));
    expect(added).toMatchObject({ ok: false, error: { code: 'tenant_not_found' } });
  });

  it('validates input and stamps tenant + author on create', async () => {
    const { repo, store } = fakeRepo();
    const invalid = await addTodo({ identity: identity('t-acme') }, { title: '  ' }, deps(repo));
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });

    const created = await addTodo({ identity: identity('t-acme') }, { title: 'Ship it' }, deps(repo));
    expect(created).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', createdBy: 'u1', title: 'Ship it' },
    });
    expect(store).toHaveLength(1);
  });
});
