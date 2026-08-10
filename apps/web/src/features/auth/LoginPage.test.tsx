import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { LoginPage } from './LoginPage.js';

const renderLoginPage = async () => {
  const rootRoute = createRootRoute({ component: LoginPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const fillCredentials = async () => {
  await userEvent.type(screen.getByLabelText('Adres e-mail'), 'demo@agentproofarch.dev');
  await userEvent.type(screen.getByLabelText('Hasło'), 'wrong-password');
};

describe('LoginPage', () => {
  it('renders labeled login inputs', async () => {
    await renderLoginPage();

    expect(screen.getByLabelText('Adres e-mail')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasło')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zaloguj się' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Podpisy' })).toBeInTheDocument();
  });

  it('renders the AppError from a failed sign-in mutation', async () => {
    server.use(
      http.post('*', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nieprawidłowy adres e-mail lub hasło',
    );
  });

  it('disables submit while the sign-in mutation is pending', async () => {
    server.use(
      http.post('*', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );

    await renderLoginPage();
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));

    expect(await screen.findByRole('button', { name: 'Logowanie…' })).toBeDisabled();
  });

  it('requests a passwordless magic link and confirms delivery (US-026)', async () => {
    server.use(http.post('*/sign-in/magic-link', () => HttpResponse.json({ status: true })));

    await renderLoginPage();
    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'mag@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij link do logowania' }));

    expect(await screen.findByText(/wiadomość znajdziesz w Mailpit/i)).toBeInTheDocument();
  });

  it('hides the Google button when the provider is not configured', async () => {
    await renderLoginPage();
    expect(screen.queryByRole('button', { name: /Zaloguj się przez Google/i })).not.toBeInTheDocument();
  });

  it('shows the Google button only when the server reports it enabled (FR-26)', async () => {
    server.use(
      http.get('*/api/config', () => HttpResponse.json({ ok: true, data: { googleEnabled: true, passwordResetEnabled: true, emailConfigured: true } })),
    );

    await renderLoginPage();
    expect(await screen.findByRole('button', { name: /Zaloguj się przez Google/i })).toBeInTheDocument();
  });

  it('hides the password reminder when reset email is not configured', async () => {
    server.use(
      http.get('*/api/config', () => HttpResponse.json({ ok: true, data: { googleEnabled: false, passwordResetEnabled: false, emailConfigured: false } })),
    );

    await renderLoginPage();
    expect(screen.queryByRole('link', { name: /Nie pamiętasz hasła/i })).not.toBeInTheDocument();
  });
});
