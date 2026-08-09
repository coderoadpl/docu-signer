import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { forbidden, type AppError } from '#core/domain/index.js';

import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { AppLayout } from './AppLayout.js';
import { documentsSearchSchema } from './features/documents/documents.logic.js';

const renderLayout = async (
  tenant: object | null,
  initialEntry = '/app',
  error?: AppError,
) => {
  server.use(
    http.get('/api/me', () => {
      if (error) return HttpResponse.json({ ok: false, error }, { status: 403 });
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
  const router = createRouter({
    routeTree: root.addChildren([app.addChildren([index, documents, trash, settings]), pad]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  renderWithProviders(<RouterProvider router={router} />);
  return router;
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
    const router = await renderLayout({
      id: 'tenant-default',
      slug: 'default',
      name: 'Archiwum',
      staffRole: 'owner',
    });
    expect(await screen.findByRole('link', { name: 'Dokumenty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kosz' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Konto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tryb pada' })).toBeInTheDocument();
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
      http.delete('/api/saved-searches/:id', ({ params }) => {
        removed(params.id);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderLayout(
      {
        id: 'tenant-default',
        slug: 'default',
        name: 'Archiwum',
        staffRole: 'owner',
      },
      '/app/documents?tag=odbiór&status=signed&szkice=all',
    );

    expect((await screen.findAllByText('TECZKI')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Odbiór' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: /Kosz/u })).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Więcej akcji dla teczki Odbiór' }));
    expect(screen.getByRole('menuitem', { name: 'Zmień nazwę' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Usuń' }));
    fireEvent.click(screen.getByRole('button', { name: 'Usuń' }));
    await waitFor(() =>
      expect(removed).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'),
    );
  });

  it('shows a closed access state without tenant-management actions', async () => {
    await renderLayout(null);
    expect(await screen.findByText('Brak dostępu do archiwum')).toBeInTheDocument();
    expect(screen.queryByText(/utwórz|zmień firmę/i)).not.toBeInTheDocument();
  });

  it('shows the no-access state without navigation when identity resolution is forbidden', async () => {
    const error = forbidden('You do not have access to this tenant');

    await renderLayout(null, '/app/documents', error);

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
});
