import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { Invitation } from '#core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { invitationManagementErrorText, InvitationsSection } from './InvitationsSection.js';

const pending: Invitation = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-default',
  email: 'anna@example.com',
  role: 'admin',
  invitedBy: 'user-owner',
  status: 'pending',
  expiresAt: '2026-08-17T10:00:00.000Z',
};

describe('InvitationsSection', () => {
  it('normalizes non-API errors', () => {
    expect(invitationManagementErrorText(new Error('Awaria'))).toBe('Awaria');
    expect(invitationManagementErrorText(null)).toBe('Wystąpił nieoczekiwany błąd');
  });

  it('shows the fallback, creates a shown-once link, and revokes a pending invite', async () => {
    const create = vi.fn();
    const revoke = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    let rows = [pending];
    server.use(
      http.get('*/api/config', () => HttpResponse.json({
        ok: true,
        data: { googleEnabled: false, passwordResetEnabled: false, emailConfigured: false },
      })),
      http.get('*/api/invitations', () =>
        HttpResponse.json({ ok: true, data: { invitations: rows } }),
      ),
      http.post('*/api/invitations', async ({ request }) => {
        const body = await request.json();
        create(body);
        return HttpResponse.json({
          ok: true,
          data: {
            invitation: { ...pending, id: '22222222-2222-4222-8222-222222222222' },
            url: 'https://podpisy.example.com/zaproszenie/secret-once',
            emailSent: false,
          },
        });
      }),
      http.post('*/api/invitations/:id/revoke', ({ params }) => {
        revoke(params.id);
        rows = [];
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );

    renderWithProviders(<InvitationsSection />);

    expect(await screen.findByText(/Wysyłka e-mail nieskonfigurowana/u)).toBeInTheDocument();
    const row = (await screen.findByText('anna@example.com')).closest('li');
    if (!row) throw new Error('Missing invitation row');
    expect(within(row).getByText('Oczekujące')).toBeInTheDocument();
    expect(within(row).queryByText(/2026|wygasa/u)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'ewa@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij zaproszenie' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ email: 'ewa@example.com', role: 'admin' }));
    expect(await screen.findByLabelText('Link zaproszenia')).toHaveValue(
      'https://podpisy.example.com/zaproszenie/secret-once',
    );
    expect(writeText).toHaveBeenCalledWith('https://podpisy.example.com/zaproszenie/secret-once');

    await userEvent.click(within(row).getByRole('button', { name: 'Unieważnij' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(pending.id));
  });

  it('hides the fallback when mail is configured and surfaces creation errors', async () => {
    server.use(
      http.get('*/api/config', () => HttpResponse.json({
        ok: true,
        data: { googleEnabled: false, passwordResetEnabled: true, emailConfigured: true },
      })),
      http.post('*/api/invitations', () => HttpResponse.json({
        ok: false,
        error: { code: 'conflict', message: 'Konto już istnieje' },
      }, { status: 409 })),
      http.get('*/api/invitations', () => HttpResponse.json({
        ok: false,
        error: { code: 'unavailable', message: 'Lista chwilowo niedostępna' },
      }, { status: 503 })),
    );
    renderWithProviders(<InvitationsSection />);
    expect(screen.queryByText(/Wysyłka e-mail nieskonfigurowana/u)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'existing@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij zaproszenie' }));
    expect(await screen.findByText('Konto już istnieje')).toBeInTheDocument();
    expect(await screen.findByText('Lista chwilowo niedostępna')).toBeInTheDocument();
  });

  it('creates an owner invitation without clipboard access and surfaces regeneration errors', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const ownerInvitation: Invitation = {
      ...pending,
      email: 'owner@example.com',
      role: 'owner',
    };
    server.use(
      http.get('*/api/config', () => HttpResponse.json({
        ok: true,
        data: { googleEnabled: false, passwordResetEnabled: true, emailConfigured: true },
      })),
      http.get('*/api/invitations', () => HttpResponse.json({
        ok: true,
        data: { invitations: [ownerInvitation, { ...pending, status: 'accepted' }] },
      })),
      http.post('*/api/invitations', async ({ request }) => {
        const body = await request.json();
        if (JSON.stringify(body).includes('"email":"owner@example.com"')) {
          return HttpResponse.json({
            ok: false,
            error: { code: 'unavailable', message: 'Nie udało się odnowić linku' },
          }, { status: 503 });
        }
        return HttpResponse.json({
          ok: true,
          data: {
            invitation: ownerInvitation,
            url: 'https://podpisy.example.com/zaproszenie/owner-secret',
            emailSent: true,
          },
        });
      }),
    );

    renderWithProviders(<InvitationsSection />);
    const ownerRow = (await screen.findByText('owner@example.com')).closest('li');
    if (!ownerRow) throw new Error('Missing owner invitation row');
    expect(within(ownerRow).getByText('Właściciel')).toBeInTheDocument();
    expect(screen.queryByText('anna@example.com')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Adres e-mail'), 'new-owner@example.com');
    await userEvent.click(screen.getByLabelText('Rola'));
    await userEvent.click(screen.getByRole('option', { name: 'Właściciel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wyślij zaproszenie' }));
    expect(await screen.findByLabelText('Link zaproszenia')).toHaveValue(
      'https://podpisy.example.com/zaproszenie/owner-secret',
    );
    const copyButtons = screen.getAllByRole('button', { name: 'Skopiuj link' });
    const shownLinkCopy = copyButtons[0];
    if (!shownLinkCopy) throw new Error('Missing shown-link copy button');
    await userEvent.click(shownLinkCopy);
    await userEvent.click(within(ownerRow).getByRole('button', { name: 'Skopiuj link' }));
    expect(await screen.findByText('Nie udało się odnowić linku')).toBeInTheDocument();
  });
});
