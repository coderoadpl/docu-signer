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
      http.post('*/two-factor/get-totp-uri', () =>
        HttpResponse.json({ code: 'TOTP_NOT_ENABLED', message: 'TOTP not enabled' }, { status: 400 }),
      ),
      http.post('*/two-factor/enable', () =>
        HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=ABCD', backupCodes: ['aaaa-bbbb'] }),
      ),
      http.post('*/two-factor/verify-totp', () => HttpResponse.json({ status: true })),
    );

    renderWithProviders(<TwoFactorSection />);

    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));

    const uri = await screen.findByLabelText('Adres URI konfiguracji TOTP');
    expect(uri).toHaveValue('otpauth://totp/demo?secret=ABCD');

    await userEvent.type(screen.getByLabelText('Kod z aplikacji'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź kod' }));

    expect(await screen.findByText(/Uwierzytelnianie dwuskładnikowe jest włączone/i)).toBeInTheDocument();
  });

  it('disables 2FA after enrolment and returns to the enable form', async () => {
    server.use(
      http.post('*/two-factor/get-totp-uri', () =>
        HttpResponse.json({ code: 'TOTP_NOT_ENABLED', message: 'TOTP not enabled' }, { status: 400 }),
      ),
      http.post('*/two-factor/enable', () =>
        HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=ABCD', backupCodes: ['aaaa-bbbb'] }),
      ),
      http.post('*/two-factor/disable', () => HttpResponse.json({ status: true })),
    );

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Wyłącz 2FA' }));

    expect(await screen.findByRole('button', { name: 'Włącz 2FA' })).toBeInTheDocument();
  });

  it('surfaces a wrong-password enable error', async () => {
    server.use(
      http.post('*/two-factor/get-totp-uri', () =>
        HttpResponse.json({ code: 'TOTP_NOT_ENABLED', message: 'TOTP not enabled' }, { status: 400 }),
      ),
      http.post('*/two-factor/enable', () => HttpResponse.json({ message: 'Invalid password' }, { status: 401 })),
    );

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nieprawidłowe hasło.');
    expect(alert).toHaveClass('MuiAlert-colorError');
  });

  it('renders a rejected code as a Polish error alert', async () => {
    server.use(
      http.post('*/two-factor/get-totp-uri', () =>
        HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=ABCD' }),
      ),
      http.post('*/two-factor/verify-totp', () =>
        HttpResponse.json({ code: 'INVALID_CODE', message: 'Invalid code' }, { status: 401 }),
      ),
    );

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));
    await userEvent.type(await screen.findByLabelText('Kod z aplikacji'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź kod' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nieprawidłowy kod. Spróbuj ponownie.');
    expect(alert).toHaveClass('MuiAlert-colorError');
  });

  it('resumes the same enrolment after the section remounts', async () => {
    let enabled = false;
    let enableCalls = 0;
    server.use(
      http.post('*/two-factor/get-totp-uri', () =>
        enabled
          ? HttpResponse.json({ totpURI: 'otpauth://totp/demo?secret=STABLE' })
          : HttpResponse.json({ code: 'TOTP_NOT_ENABLED', message: 'TOTP not enabled' }, { status: 400 }),
      ),
      http.post('*/two-factor/enable', () => {
        enabled = true;
        enableCalls += 1;
        return HttpResponse.json({
          totpURI: 'otpauth://totp/demo?secret=STABLE',
          backupCodes: ['aaaa-bbbb'],
        });
      }),
    );

    const first = renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));
    expect(await screen.findByLabelText('Adres URI konfiguracji TOTP')).toHaveValue(
      'otpauth://totp/demo?secret=STABLE',
    );
    first.unmount();

    renderWithProviders(<TwoFactorSection />);
    await userEvent.type(screen.getByLabelText('Hasło do konta'), 'demo1234');
    await userEvent.click(screen.getByRole('button', { name: 'Włącz 2FA' }));
    expect(await screen.findByLabelText('Adres URI konfiguracji TOTP')).toHaveValue(
      'otpauth://totp/demo?secret=STABLE',
    );
    expect(enableCalls).toBe(1);
  });
});
