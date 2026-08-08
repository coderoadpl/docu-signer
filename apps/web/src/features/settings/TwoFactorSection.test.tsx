import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { TwoFactorSection } from './TwoFactorSection.js';

describe('TwoFactorSection', () => {
  it('walks enable → enrolment URI → verify (US-028a TOTP)', async () => {
    server.use(
      http.post('*/two-factor/enable', () =>
        HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=ABCD', backupCodes: ['aaaa-bbbb'] }),
      ),
      http.post('*/two-factor/verify-totp', () => HttpResponse.json({ status: true })),
    );

    renderWithProviders(<TwoFactorSection />);

    await userEvent.type(screen.getByLabelText('account password'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'enable 2FA' }));

    const uri = await screen.findByLabelText('totp enrolment uri');
    expect(uri).toHaveValue('otpauth://totp/demo?secret=ABCD');

    await userEvent.type(screen.getByLabelText('authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'verify code' }));

    expect(await screen.findByText(/two-factor authentication is enabled/i)).toBeInTheDocument();
  });

  it('disables 2FA after enrolment and returns to the enable form', async () => {
    server.use(
      http.post('*/two-factor/enable', () =>
        HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=ABCD', backupCodes: ['aaaa-bbbb'] }),
      ),
      http.post('*/two-factor/disable', () => HttpResponse.json({ status: true })),
    );

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('account password'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'enable 2FA' }));

    await userEvent.click(await screen.findByRole('button', { name: 'disable 2FA' }));

    expect(await screen.findByRole('button', { name: 'enable 2FA' })).toBeInTheDocument();
  });

  it('surfaces a wrong-password enable error', async () => {
    server.use(
      http.post('*/two-factor/enable', () => HttpResponse.json({ message: 'Invalid password' }, { status: 401 })),
    );

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('account password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'enable 2FA' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid password/i);
  });
});
