import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { SettingsPage } from './SettingsPage.js';

const renderSettings = async (staffRole: 'owner' | 'admin' | null) => {
  server.use(
    http.get('/api/me', () =>
      HttpResponse.json({
        ok: true,
        data: { userId: 'u1', email: 'e@x.dev', name: 'E', tenant: { id: 't1', slug: 'acme', name: 'Acme Inc', staffRole, memberId: null } },
      }),
    ),
    http.get('/api/tenants', () =>
      HttpResponse.json({
        ok: true,
        data: { tenants: staffRole === null ? [] : [{ tenant: { id: 't1', slug: 'acme', name: 'Acme Inc' }, staffRole }] },
      }),
    ),
  );
  const rootRoute = createRootRoute({});
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/app/settings', component: SettingsPage });
  const staff = createRoute({ getParentRoute: () => rootRoute, path: '/app/settings/staff', component: () => <p>staff</p> });
  const domains = createRoute({ getParentRoute: () => rootRoute, path: '/app/settings/domains', component: () => <p>domains</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route, staff, domains]),
    history: createMemoryHistory({ initialEntries: ['/app/settings'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('SettingsPage', () => {
  it('shows the current tenant, my role and the staff/domains links for staff', async () => {
    await renderSettings('owner');
    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /staff/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /domains/ })).toBeInTheDocument();
  });

  it('warns an admin that owner-only surfaces are restricted', async () => {
    await renderSettings('admin');
    expect(await screen.findByText(/Granting staff and changing domains are owner-only/)).toBeInTheDocument();
  });

  it('hides the staff/domains links from a non-staff member', async () => {
    await renderSettings(null);
    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /staff/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /domains/ })).not.toBeInTheDocument();
  });
});
