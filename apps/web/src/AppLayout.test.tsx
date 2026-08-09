import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { forbidden, type AppError } from '#core/domain/index.js';

import { renderWithProviders } from './test/render.js';
import { server } from './test/server.js';
import { AppLayout } from './AppLayout.js';

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
    component: () => <p>documents</p>,
  });
  const settings = createRoute({
    getParentRoute: () => app,
    path: 'settings',
    component: () => <p>settings</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([app.addChildren([index, documents, settings])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  renderWithProviders(<RouterProvider router={router} />);
};

describe('AppLayout', () => {
  it('shows only documents and account navigation for a trusted user', async () => {
    await renderLayout({
      id: 'tenant-default',
      slug: 'default',
      name: 'Archiwum',
      staffRole: 'owner',
    });
    expect(await screen.findByRole('link', { name: 'Dokumenty' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Konto' })).toBeInTheDocument();
    expect(screen.queryByText(/rejestr|tablica|członkowie/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
  });
});
