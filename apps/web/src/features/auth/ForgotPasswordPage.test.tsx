import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ForgotPasswordPage } from './ForgotPasswordPage.js';

const renderForgotPasswordPage = async () => {
  const rootRoute = createRootRoute({ component: ForgotPasswordPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/forgot-password'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('ForgotPasswordPage', () => {
  it('requests a password-reset email without exposing account existence', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/request-password-reset', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );

    await renderForgotPasswordPage();
    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'ada@example.com');
    const submit = await screen.findByRole('button', { name: 'Wyślij link resetowania' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);

    expect(await screen.findByText(/Jeśli ten adres ma konto/i)).toBeInTheDocument();
    expect(body).toEqual({
      email: 'ada@example.com',
      redirectTo: 'http://localhost:3000/reset-password',
    });
  });

  it('blocks the form when reset email is not configured', async () => {
    server.use(
      http.get('*/api/config', () => HttpResponse.json({ ok: true, data: { googleEnabled: false, passwordResetEnabled: false } })),
    );

    await renderForgotPasswordPage();

    expect(await screen.findByText(/Reset hasła nie jest jeszcze skonfigurowany/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wyślij link resetowania' })).toBeDisabled();
  });
});
