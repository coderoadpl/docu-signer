import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { ApiToken } from '#core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { ApiTokenSection } from './ApiTokenSection.js';

const token: ApiToken = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  name: 'Importer',
  scopes: ['write:draft'],
  createdAt: '2026-08-02T09:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

describe('ApiTokenSection', () => {
  it('creates a token once and revokes it with inline confirmation', async () => {
    const create = vi.fn();
    const revoke = vi.fn();
    let tokens: ApiToken[] = [
      {
        ...token,
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Eksport',
        scopes: ['read'],
        lastUsedAt: '2026-08-01T10:00:00.000Z',
      },
    ];
    server.use(
      http.get('/api/api-tokens', () =>
        HttpResponse.json({ ok: true, data: { apiTokens: tokens } }),
      ),
      http.post('/api/api-tokens', async ({ request }) => {
        const body = await request.json();
        create(body);
        tokens = [token, ...tokens];
        return HttpResponse.json({
          ok: true,
          data: { apiToken: token, value: 'pat_secret_once' },
        });
      }),
      http.post('/api/api-tokens/:id/revoke', ({ params }) => {
        revoke(params.id);
        tokens = tokens.map((item) =>
          item.id === params.id
            ? { ...item, revokedAt: '2026-08-02T10:00:00.000Z' }
            : item,
        );
        return HttpResponse.json({ ok: true, data: { revoked: true } });
      }),
    );

    renderWithProviders(<ApiTokenSection />);

    expect(await screen.findByText('Eksport')).toBeInTheDocument();
    expect(screen.getByText('Ostatnio użyty: 01.08.2026')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nazwa tokenu'), 'Importer');
    await userEvent.click(screen.getByRole('checkbox', { name: /Odczyt/u }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Zapis szkiców/u }));
    await userEvent.click(screen.getByRole('button', { name: 'Utwórz token' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Importer',
        scopes: ['write:draft'],
      }),
    );
    const tokenField = await screen.findByLabelText('Wartość tokenu');
    expect(tokenField).toHaveValue('pat_secret_once');
    expect(screen.getAllByDisplayValue('pat_secret_once')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Kopiuj' })).toBeInTheDocument();
    expect(screen.getByText(/nie będzie już nigdy pokazana/u)).toBeInTheDocument();
    expect(await screen.findByText('Ostatnio użyty: Nigdy')).toBeInTheDocument();

    const row = screen.getByText('Importer').closest('li');
    if (!row) throw new Error('Missing token row');
    await userEvent.click(within(row).getByRole('button', { name: 'Odwołaj' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Potwierdź' }));

    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'),
    );
    expect(await within(row).findByText('Odwołany')).toBeInTheDocument();
  });
});
