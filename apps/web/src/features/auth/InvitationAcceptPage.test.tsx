import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { invitationAcceptanceErrorText, InvitationAcceptPage } from './InvitationAcceptPage.js';

const renderPage = async () => {
  const root = createRootRoute({ component: Outlet });
  const invitation = createRoute({
    getParentRoute: () => root,
    path: '/zaproszenie/$token',
    component: () => <InvitationAcceptPage token="invite-secret" />,
  });
  const app = createRoute({
    getParentRoute: () => root,
    path: '/app',
    component: () => <p>Nowy użytkownik</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([invitation, app]),
    history: createMemoryHistory({ initialEntries: ['/zaproszenie/invite-secret'] }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

describe('InvitationAcceptPage', () => {
  it('normalizes non-API errors', () => {
    expect(invitationAcceptanceErrorText(new Error('Awaria'))).toBe('Awaria');
    expect(invitationAcceptanceErrorText(null)).toBe('Wystąpił nieoczekiwany błąd');
  });

  it('shows organization and email without dates, accepts, and signs the new user in', async () => {
    const accept = vi.fn();
    const signIn = vi.fn();
    server.use(
      http.get('*/api/public/invitations/invite-secret', () => HttpResponse.json({
        ok: true,
        data: {
          invitation: {
            email: 'anna@example.com',
            organizationName: 'Archiwum Podpisy',
            status: 'pending',
          },
        },
      })),
      http.post('*/api/public/invitations/invite-secret/accept', async ({ request }) => {
        accept(await request.json());
        return HttpResponse.json({ ok: true, data: { accepted: true, email: 'anna@example.com' } });
      }),
      http.post('*', async ({ request }) => {
        signIn(await request.json());
        return HttpResponse.json({
          token: 'session-token',
          user: { id: 'new-user', email: 'anna@example.com', name: 'anna' },
        });
      }),
    );

    await renderPage();

    expect(await screen.findByText('Archiwum Podpisy')).toBeInTheDocument();
    expect(screen.getByText('anna@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/wygasa|2026/u)).not.toBeInTheDocument();
    expect(screen.getByText(/klucz dostępu.*dwuskładnikowe/iu)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Ustaw hasło'), 'nowe-haslo-123');
    await userEvent.type(screen.getByLabelText('Powtórz hasło'), 'nowe-haslo-123');
    await userEvent.click(screen.getByRole('button', { name: 'Dołącz do archiwum' }));

    await waitFor(() => expect(accept).toHaveBeenCalledWith({ password: 'nowe-haslo-123' }));
    await waitFor(() => expect(signIn).toHaveBeenCalled());
    expect(await screen.findByText('Nowy użytkownik')).toBeInTheDocument();
  });

  it('shows a quiet invalid state for a revoked or expired token', async () => {
    server.use(
      http.get('*/api/public/invitations/invite-secret', () => HttpResponse.json({
        ok: false,
        error: { code: 'conflict', message: 'Invitation is no longer active' },
      }, { status: 409 })),
    );
    await renderPage();
    expect(await screen.findByText(/nieprawidłowe, wygasło lub zostało unieważnione/u)).toBeInTheDocument();
  });

  it('validates matching passwords and surfaces an acceptance failure', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/public/invitations/invite-secret', () => HttpResponse.json({
        ok: true,
        data: {
          invitation: {
            email: 'anna@example.com',
            organizationName: 'Archiwum Podpisy',
            status: 'pending',
          },
        },
      })),
      http.post('*/api/public/invitations/invite-secret/accept', () => {
        calls += 1;
        return HttpResponse.json({
          ok: false,
          error: { code: 'conflict', message: 'Zaproszenie zostało już wykorzystane' },
        }, { status: 409 });
      }),
    );
    await renderPage();
    await screen.findByText('Archiwum Podpisy');
    await userEvent.type(screen.getByLabelText('Ustaw hasło'), 'nowe-haslo-123');
    await userEvent.type(screen.getByLabelText('Powtórz hasło'), 'inne-haslo-123');
    await userEvent.click(screen.getByRole('button', { name: 'Dołącz do archiwum' }));
    expect(await screen.findByText('Hasła muszą być takie same')).toBeInTheDocument();
    expect(calls).toBe(0);
    await userEvent.clear(screen.getByLabelText('Powtórz hasło'));
    await userEvent.type(screen.getByLabelText('Powtórz hasło'), 'nowe-haslo-123');
    await userEvent.click(screen.getByRole('button', { name: 'Dołącz do archiwum' }));
    expect(await screen.findByText('Zaproszenie zostało już wykorzystane')).toBeInTheDocument();
    expect(calls).toBe(1);
  });
});
