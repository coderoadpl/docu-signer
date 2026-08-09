import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ResetPasswordPage, resetPasswordSearchSchema } from './ResetPasswordPage.js';

const renderResetPasswordPage = async (search: string) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reset-password',
    validateSearch: resetPasswordSearchSchema,
    component: ResetPasswordPage,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([resetRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: [`/reset-password${search}`] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('ResetPasswordPage', () => {
  it('rejects an invalid or expired reset link', async () => {
    await renderResetPasswordPage('?error=INVALID_TOKEN');
    expect(screen.getByText(/nieprawidłowy albo wygasł/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Poproś o nowy link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('sets a new password with the token from the link', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/reset-password', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );

    await renderResetPasswordPage('?token=reset-token-1');
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'nowe-haslo-123');
    await userEvent.type(screen.getByLabelText('Powtórz hasło'), 'nowe-haslo-123');
    await userEvent.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));

    expect(await screen.findByText(/Hasło zostało zmienione/i)).toBeInTheDocument();
    expect(body).toEqual({ token: 'reset-token-1', newPassword: 'nowe-haslo-123' });
  });

  it('validates matching passwords before calling the provider', async () => {
    let calls = 0;
    server.use(
      http.post('*/reset-password', () => {
        calls += 1;
        return HttpResponse.json({ status: true });
      }),
    );

    await renderResetPasswordPage('?token=reset-token-1');
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'nowe-haslo-123');
    await userEvent.type(screen.getByLabelText('Powtórz hasło'), 'inne-haslo-123');
    await userEvent.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }));

    expect(await screen.findByText('Hasła muszą być takie same')).toBeInTheDocument();
    expect(calls).toBe(0);
  });
});
