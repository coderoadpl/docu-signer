import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ProfileSection } from './ProfileSection.js';

const identity = (name: string) => ({
  ok: true,
  data: {
    userId: 'user-owner',
    email: 'owner@example.com',
    name,
    tenant: {
      id: 'tenant-default',
      slug: 'default',
      name: 'Archiwum',
      staffRole: 'owner',
    },
  },
});

describe('ProfileSection', () => {
  it('updates the trimmed display name and refreshes the signed-in identity', async () => {
    let currentName = 'Owner';
    let body: unknown = null;
    let identityCalls = 0;
    server.use(
      http.get('*/api/me', () => {
        identityCalls += 1;
        return HttpResponse.json(identity(currentName));
      }),
      http.post('*/update-user', async ({ request }) => {
        body = await request.json();
        currentName = 'Maria Kowalska';
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<ProfileSection />);
    const field = await screen.findByDisplayValue('Owner');
    await userEvent.clear(field);
    await userEvent.type(field, '  Maria Kowalska  ');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByText('Imię i nazwisko zostało zapisane.')).toBeInTheDocument();
    expect(field).toHaveValue('Maria Kowalska');
    expect(body).toEqual({ name: 'Maria Kowalska' });
    expect(identityCalls).toBeGreaterThan(1);
  });

  it('rejects an empty display name before calling the provider', async () => {
    let calls = 0;
    server.use(
      http.post('*/update-user', () => {
        calls += 1;
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<ProfileSection />);
    const field = await screen.findByDisplayValue('Owner');
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(await screen.findByText('Imię i nazwisko nie może być puste')).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it('rejects a display name longer than 200 characters before calling the provider', async () => {
    let calls = 0;
    server.use(
      http.post('*/update-user', () => {
        calls += 1;
        return HttpResponse.json({ status: true });
      }),
    );

    renderWithProviders(<ProfileSection />);
    const field = await screen.findByDisplayValue('Owner');
    await userEvent.clear(field);
    await userEvent.type(field, 'a'.repeat(201));
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    expect(
      await screen.findByText('Imię i nazwisko może mieć maksymalnie 200 znaków'),
    ).toBeInTheDocument();
    expect(calls).toBe(0);
  });
});
