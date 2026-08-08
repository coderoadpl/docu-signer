import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { PasskeySection } from './PasskeySection.js';

const passkeyRow = (over: { id: string; name: string; createdAt: string }) => ({
  userId: 'u1',
  publicKey: 'pk',
  credentialID: `cred-${over.id}`,
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  transports: 'internal',
  ...over,
});

describe('PasskeySection', () => {
  it('lists registered passkeys with their creation date (US-028a)', async () => {
    server.use(
      http.get('*/passkey/list-user-passkeys', () =>
        HttpResponse.json([passkeyRow({ id: 'pk-1', name: 'MacBook Touch ID', createdAt: '2026-07-03T00:00:00.000Z' })]),
      ),
    );

    renderWithProviders(<PasskeySection />);

    expect(await screen.findByText('MacBook Touch ID')).toBeInTheDocument();
    expect(screen.getByText(/added/i)).toBeInTheDocument();
  });

  it('shows the empty state when no passkeys are registered', async () => {
    server.use(http.get('*/passkey/list-user-passkeys', () => HttpResponse.json([])));

    renderWithProviders(<PasskeySection />);

    expect(await screen.findByText(/no passkeys registered yet/i)).toBeInTheDocument();
  });

  it('removes a passkey behind an inline confirmation', async () => {
    let deleted = false;
    server.use(
      http.get('*/passkey/list-user-passkeys', () =>
        HttpResponse.json(
          deleted ? [] : [passkeyRow({ id: 'pk-1', name: 'YubiKey', createdAt: '2026-07-03T00:00:00.000Z' })],
        ),
      ),
      http.post('*/passkey/delete-passkey', () => {
        deleted = true;
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<PasskeySection />);

    await userEvent.click(await screen.findByRole('button', { name: 'remove' }));
    await userEvent.click(await screen.findByRole('button', { name: 'confirm remove' }));

    expect(await screen.findByText(/no passkeys registered yet/i)).toBeInTheDocument();
  });
});
