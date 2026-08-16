import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { forbidden, unauthorized, type AppError } from '#core/domain/index.js';

import { actions } from './api.js';
import { createTestQueryClient, renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { AppLayout } from './AppLayout.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { documentsSearchSchema } from './features/documents/documents.logic.js';

interface RenderLayoutOptions {
  tenant: object | null;
  initialEntry?: string;
  error?: AppError;
  queryClient?: QueryClient;
  waitForMe?: Promise<void>;
}

const renderLayout = async ({
  tenant,
  initialEntry = '/app',
  error,
  queryClient = createTestQueryClient(),
  waitForMe,
}: RenderLayoutOptions) => {
  server.use(
    http.get('/api/me', async () => {
      await waitForMe;
      if (error) {
        return HttpResponse.json(
          { ok: false, error },
          { status: error.code === 'unauthorized' ? 401 : 403 },
        );
      }
      return HttpResponse.json({
        ok: true,
        data: {
          userId: 'u1',
          email: 'user@example.com',
          name: 'User',
          tenant,
        },
      });
    }),
  );
  const root = createRootRoute({});
  const app = createRoute({
    getParentRoute: () => root,
    path: '/app',
    component: AppLayout,
  });
  const index = createRoute({
    getParentRoute: () => app,
    path: '/',
    component: () => <p>archive content</p>,
  });
  const documents = createRoute({
    getParentRoute: () => app,
    path: 'documents',
    validateSearch: documentsSearchSchema,
    component: () => <p>documents</p>,
  });
  const trash = createRoute({
    getParentRoute: () => app,
    path: 'kosz',
    component: () => <p>trash</p>,
  });
  const settings = createRoute({
    getParentRoute: () => app,
    path: 'settings',
    component: () => <p>settings</p>,
  });
  const pad = createRoute({
    getParentRoute: () => root,
    path: '/pad/$sessionId',
    component: () => <p>pad</p>,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: () => <p>login page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      app.addChildren([index, documents, trash, settings]),
      login,
      pad,
    ]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return {
    router,
    ...renderWithProviders(<RouterProvider router={router} />, { queryClient }),
  };
};

const renderLoginWithApp = async () => {
  const root = createRootRoute({ component: Outlet });
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: LoginPage,
  });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/app',
    component: AppLayout,
  });
  const index = createRoute({
    getParentRoute: () => app,
    path: '/',
    component: () => <p>archive content</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([login, app.addChildren([index])]),
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('AppLayout', () => {
  it('shows document, trash, and account navigation for a trusted user', async () => {
    server.use(
      http.post('/api/pad-sessions/join', () =>
        HttpResponse.json({
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
        }),
      ),
    );
    const { router } = await renderLayout({
      tenant: {
        id: 'tenant-default',
        slug: 'default',
        name: 'Archiwum',
        staffRole: 'owner',
      },
    });
    expect(await screen.findByRole('link', { name: 'Dokumenty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kosz' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Konto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tryb pada' })).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.queryByText(/rejestr|tablica|członkowie/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tryb pada' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/pad/11111111-1111-4111-8111-111111111111',
      ),
    );
  });

  it('renders active teczki links and the quiet trash count in the sidebar', async () => {
    const removed = vi.fn();
    server.use(
      http.get('/api/saved-searches', () =>
        HttpResponse.json({
          ok: true,
          data: {
            savedSearches: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                tenantId: 'tenant-default',
                name: 'Odbiór',
                filter: { tag: 'odbiór', signatureStatus: 'signed', draft: 'all' },
                createdAt: '2026-08-01T00:00:00.000Z',
              },
            ],
          },
        }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                tenantId: 'tenant-default',
                title: 'Usunięty dokument',
                docType: 'inny',
                documentDate: '2026-08-01',
                periodStart: null,
                periodEnd: null,
                person: null,
                tags: [],
                draft: false,
                deletedAt: '2026-08-02T09:00:00.000Z',
                createdAt: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-02T09:00:00.000Z',
                files: [],
              },
            ],
          },
        }),
      ),
      http.get('/api/source-update-requests/pending', () =>
        HttpResponse.json({
          ok: true,
          data: {
            requests: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                tenantId: 'tenant-default',
                documentId: '55555555-5555-4555-8555-555555555555',
                requestedBy: 'user-owner',
                newSourceFileId: '66666666-6666-4666-8666-666666666666',
                mode: 'transfer',
                status: 'pending',
                approvals: [
                  {
                    id: '77777777-7777-4777-8777-777777777777',
                    approverId: 'u1',
                    decision: 'pending',
                  },
                ],
              },
            ],
          },
        }),
      ),
      http.delete('/api/saved-searches/:id', ({ params }) => {
        removed(params.id);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderLayout({
      tenant: {
        id: 'tenant-default',
        slug: 'default',
        name: 'Archiwum',
        staffRole: 'owner',
      },
      initialEntry: '/app/documents?tag=odbiór&status=signed&szkice=all',
    });

    expect((await screen.findAllByText('TECZKI')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Odbiór' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: /Kosz/u })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /Aktualizacje źródeł/u })).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Więcej akcji dla teczki Odbiór' }));
    expect(screen.getByRole('menuitem', { name: 'Zmień nazwę' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usuń' }));
    await waitFor(() =>
      expect(removed).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'),
    );
  });

  it('shows a closed access state without tenant-management actions', async () => {
    await renderLayout({ tenant: null });
    expect(await screen.findByText('Brak dostępu do archiwum')).toBeInTheDocument();
    expect(screen.queryByText(/utwórz|zmień firmę/i)).not.toBeInTheDocument();
  });

  it('shows the no-access state without navigation when identity resolution is forbidden', async () => {
    const error = forbidden('You do not have access to this tenant');

    await renderLayout({ tenant: null, initialEntry: '/app/documents', error });

    expect(await screen.findByText('Brak dostępu do archiwum')).toBeInTheDocument();
    expect(
      screen.getByText('To konto nie jest przypisane do archiwum dokumentów.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyloguj się' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dokumenty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Konto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tryb pada' })).not.toBeInTheDocument();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
  });

  it('shows loading while a cached unauthorized result is refetching', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryDefaults(actions.me.queryKey, { gcTime: Infinity });
    await expect(
      queryClient.fetchQuery({
        ...actions.me,
        queryFn: () => Promise.reject(new ApiError(unauthorized())),
      }),
    ).rejects.toThrow('Authentication required');
    let finishMeRequest = () => {};
    const waitForMe = new Promise<void>((resolve) => {
      finishMeRequest = resolve;
    });

    const { router } = await renderLayout({
      tenant: {
        id: 'tenant-default',
        slug: 'default',
        name: 'Archiwum',
        staffRole: 'owner',
      },
      queryClient,
      waitForMe,
    });

    expect(await screen.findByText('Ładowanie aplikacji…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app');

    finishMeRequest();
    expect(await screen.findByText('archive content')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app');
  });

  it('redirects after an unauthorized result settles', async () => {
    const { router } = await renderLayout({ tenant: null, error: unauthorized() });

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('stays in the app after signing in with a cached unauthorized session', async () => {
    let authenticated = false;
    let meRequests = 0;
    let finishMeRequest = () => {};
    const waitForAuthenticatedMe = new Promise<void>((resolve) => {
      finishMeRequest = resolve;
    });
    server.use(
      http.get('/api/me', async () => {
        meRequests += 1;
        if (!authenticated) {
          return HttpResponse.json(
            { ok: false, error: unauthorized() },
            { status: 401 },
          );
        }
        await waitForAuthenticatedMe;
        return HttpResponse.json({
          ok: true,
          data: {
            userId: 'u1',
            email: 'user@example.com',
            name: 'User',
            tenant: {
              id: 'tenant-default',
              slug: 'default',
              name: 'Archiwum',
              staffRole: 'owner',
            },
          },
        });
      }),
      http.post('*/sign-in/email', () => {
        authenticated = true;
        return HttpResponse.json({
          token: 'session-token',
          user: { id: 'u1', email: 'user@example.com', name: 'User' },
        });
      }),
    );
    const { router, queryClient } = await renderLoginWithApp();
    queryClient.setQueryDefaults(actions.me.queryKey, { gcTime: Infinity });
    await expect(queryClient.fetchQuery(actions.me)).rejects.toThrow('Authentication required');

    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'demo@agentproofarch.dev');
    await userEvent.type(screen.getByLabelText('Hasło'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect(await screen.findByText('Ładowanie aplikacji…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app');

    finishMeRequest();
    expect(await screen.findByText('archive content')).toBeInTheDocument();
    expect(meRequests).toBe(2);
    expect(router.state.location.pathname).toBe('/app');
  });
});
