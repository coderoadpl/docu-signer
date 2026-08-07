import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TodosPage } from './TodosPage.js';

const meWithTenant = {
  userId: 'u1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
  tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: null },
};

const tenantsBody = {
  tenants: [{ tenant: { id: 't1', slug: 'acme', name: 'Acme' }, staffRole: 'owner' }],
};

const makeTodo = (id: string, title: string) => ({
  id,
  tenantId: 't1',
  title,
  createdBy: 'u1',
  createdAt: '2026-07-11T00:00:00.000Z',
});

const renderTodosPage = async () => {
  const rootRoute = createRootRoute({ component: TodosPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('TodosPage', () => {
  it('surfaces a non-2xx todos response as an error', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/todos', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'Please sign in again' } },
          { status: 401 },
        ),
      ),
    );

    await renderTodosPage();

    expect(await screen.findByText('Please sign in again')).toBeInTheDocument();
  });

  it('refetches the list after an add-todo mutation settles', async () => {
    const todos = [makeTodo('1', 'first entry')];
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meWithTenant })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: tenantsBody })),
      http.get('/api/todos', () => HttpResponse.json({ ok: true, data: { todos } })),
      http.post('/api/todos', () => {
        const created = makeTodo('2', 'second entry');
        todos.push(created);
        return HttpResponse.json({ ok: true, data: { todo: created } });
      }),
    );

    await renderTodosPage();

    expect(await screen.findByText('first entry')).toBeInTheDocument();
    expect(screen.queryByText('second entry')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New todo title'), 'second entry');
    await userEvent.click(screen.getByRole('button', { name: /add/i }));

    expect(await screen.findByText('second entry')).toBeInTheDocument();
  });
});
