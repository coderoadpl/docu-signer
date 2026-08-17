import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { HiddenFilterValue } from '#core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { HiddenFilterValuesSection } from './HiddenFilterValuesSection.js';

const documentRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-default',
  title: 'Umowa z Anną',
  docType: 'umowa-uod',
  documentDate: '2026-07-18',
  periodStart: null,
  periodEnd: null,
  person: 'Anna Nowak',
  tags: ['ważne'],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  signers: [],
  files: [],
};

const hiddenTag: HiddenFilterValue = {
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: 'tenant-default',
  kind: 'tag',
  value: 'archiwum',
};

describe('HiddenFilterValuesSection', () => {
  it('hides an existing party and restores a hidden tag', async () => {
    const hide = vi.fn();
    const unhide = vi.fn();
    let rows: HiddenFilterValue[] = [hiddenTag];
    server.use(
      http.get('*/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [documentRow] } }),
      ),
      http.get('*/api/hidden-filter-values', () =>
        HttpResponse.json({ ok: true, data: { hiddenFilterValues: rows } }),
      ),
      http.post('*/api/hidden-filter-values', async ({ request }) => {
        const body = await request.json();
        hide(body);
        const created: HiddenFilterValue = {
          id: '33333333-3333-4333-8333-333333333333',
          tenantId: 'tenant-default',
          kind: 'person',
          value: 'Anna Nowak',
        };
        rows = [...rows, created];
        return HttpResponse.json({ ok: true, data: { hiddenFilterValue: created } });
      }),
      http.post('*/api/hidden-filter-values/unhide', async ({ request }) => {
        const body = await request.json();
        unhide(body);
        rows = rows.filter((row) => row.value !== hiddenTag.value);
        return HttpResponse.json({ ok: true, data: { unhidden: true } });
      }),
    );

    renderWithProviders(<HiddenFilterValuesSection />);
    const personInput = await screen.findByRole('combobox', { name: 'Strona' });
    await userEvent.type(personInput, 'Anna');
    await userEvent.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    const hideButtons = screen.getAllByRole('button', { name: 'Ukryj' });
    const personHideButton = hideButtons[0];
    if (!personHideButton) throw new Error('Missing hide button');
    await userEvent.click(personHideButton);
    await waitFor(() =>
      expect(hide).toHaveBeenCalledWith({ kind: 'person', value: 'Anna Nowak' }),
    );
    expect(await screen.findByText('Anna Nowak')).toBeInTheDocument();

    const archiwumRow = screen.getByText('archiwum').closest('li');
    if (!archiwumRow) throw new Error('Missing hidden value row');
    await userEvent.click(within(archiwumRow).getByRole('button', { name: 'Przywróć' }));
    await waitFor(() => expect(unhide).toHaveBeenCalledWith({ kind: 'tag', value: 'archiwum' }));
    await waitFor(() => expect(screen.queryByText('archiwum')).not.toBeInTheDocument());
  });
});
