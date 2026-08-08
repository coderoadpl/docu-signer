import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { AppLayout } from './AppLayout.js';

const meAcme = {
  userId: 'u1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
  tenant: { id: 't1', slug: 'acme', name: 'Acme Inc', staffRole: 'owner', memberId: null },
};
const acme = { tenant: { id: 't1', slug: 'acme', name: 'Acme Inc' }, staffRole: 'owner' };
const globex = { tenant: { id: 't2', slug: 'globex', name: 'Globex Inc' }, staffRole: 'admin' };

const renderApp = async (initial = '/app') => {
  const rootRoute = createRootRoute({});
  const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => <p>login page</p> });
  const layout = createRoute({ getParentRoute: () => rootRoute, path: '/app', component: AppLayout });
  const index = createRoute({ getParentRoute: () => layout, path: '/', component: () => <p>ledger content</p> });
  const settings = createRoute({ getParentRoute: () => layout, path: 'settings', component: () => <p>settings page</p> });
  const board = createRoute({ getParentRoute: () => layout, path: 'board', component: () => <p>board page</p> });
  const teamBoard = createRoute({ getParentRoute: () => layout, path: 'team-board', component: () => <p>team page</p> });
  const members = createRoute({ getParentRoute: () => layout, path: 'members', component: () => <p>members page</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      loginRoute,
      layout.addChildren([index, settings, board, teamBoard, members]),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('AppLayout', () => {
  it('renders the active child and a tenant switcher listing my tenants', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: meAcme })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: { tenants: [acme, globex] } })),
    );

    await renderApp();

    expect(await screen.findByText('ledger content')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch tenant' }));
    expect(await screen.findByText('Globex Inc')).toBeInTheDocument();
  });

  it('shows the create-tenant onboarding when the caller has no tenant on this host', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: { ...meAcme, tenant: null } })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: { tenants: [] } })),
    );

    await renderApp();

    expect(await screen.findByLabelText('New tenant name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'create tenant' })).toBeInTheDocument();
    expect(screen.queryByText('ledger content')).not.toBeInTheDocument();
  });

  it('treats a forbidden tenant host as onboarding, not an error', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'forbidden', message: 'no access' } }, { status: 403 }),
      ),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: { tenants: [acme] } })),
    );

    await renderApp();

    expect(await screen.findByLabelText('New tenant name')).toBeInTheDocument();
  });

  it('onboarding lists my existing tenants as switch links', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ ok: true, data: { ...meAcme, tenant: null } })),
      http.get('/api/tenants', () => HttpResponse.json({ ok: true, data: { tenants: [globex] } })),
    );

    await renderApp();

    expect(await screen.findByRole('link', { name: /Globex Inc/ })).toBeInTheDocument();
  });

  it('surfaces an unexpected error rather than onboarding when me fails internally', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );

    await renderApp();

    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByLabelText('New tenant name')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to /login', async () => {
    server.use(
      http.get('/api/me', () =>
        HttpResponse.json({ ok: false, error: { code: 'unauthorized', message: 'login' } }, { status: 401 }),
      ),
    );

    await renderApp();

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('ledger content')).not.toBeInTheDocument();
  });
});
