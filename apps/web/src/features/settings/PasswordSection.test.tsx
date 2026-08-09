import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { PasswordSection } from './PasswordSection.js';

describe('PasswordSection', () => {
  it('changes the signed-in account password', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/change-password', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<PasswordSection />);
    await userEvent.type(screen.getByLabelText('Obecne hasło'), 'demo1234');
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'nowe-haslo-123');
    await userEvent.click(screen.getByLabelText('Wyloguj inne sesje'));
    await userEvent.click(screen.getByRole('button', { name: 'Zmień hasło' }));

    expect(await screen.findByText(/Hasło zostało zmienione/i)).toBeInTheDocument();
    expect(body).toEqual({
      currentPassword: 'demo1234',
      newPassword: 'nowe-haslo-123',
      revokeOtherSessions: true,
    });
  });

  it('validates the new password before calling the provider', async () => {
    let calls = 0;
    server.use(
      http.post('*/change-password', () => {
        calls += 1;
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<PasswordSection />);
    await userEvent.type(screen.getByLabelText('Obecne hasło'), 'demo1234');
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Zmień hasło' }));

    expect(await screen.findByText('Hasło musi mieć co najmniej 8 znaków')).toBeInTheDocument();
    expect(calls).toBe(0);
  });
});
