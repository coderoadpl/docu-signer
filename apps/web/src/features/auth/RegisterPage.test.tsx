import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { RegisterPage } from './RegisterPage.js';

const renderRegisterPage = async () => {
  const rootRoute = createRootRoute({ component: RegisterPage });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/register'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('RegisterPage', () => {
  it('renders labeled registration inputs', async () => {
    await renderRegisterPage();
    expect(screen.getByLabelText('name')).toBeInTheDocument();
    expect(screen.getByLabelText('email')).toBeInTheDocument();
    expect(screen.getByLabelText('password')).toBeInTheDocument();
  });

  it('surfaces per-field zod errors on an empty submit without calling the server', async () => {
    let calls = 0;
    server.use(
      http.post('*', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );

    await renderRegisterPage();
    await userEvent.click(screen.getByRole('button', { name: 'create account' }));

    expect(await screen.findByText('Enter your name')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it('flags a malformed email and a short password as field errors', async () => {
    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText('name'), 'Ada');
    await userEvent.type(screen.getByLabelText('email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'create account' }));

    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
  });

  it('shows a form-level alert when the server rejects a valid submission', async () => {
    server.use(
      http.post('*', () => HttpResponse.json({ message: 'User already exists' }, { status: 422 })),
    );

    await renderRegisterPage();
    await userEvent.type(screen.getByLabelText('name'), 'Ada');
    await userEvent.type(screen.getByLabelText('email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('password'), 'strong-pass-1');
    await userEvent.click(screen.getByRole('button', { name: 'create account' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
