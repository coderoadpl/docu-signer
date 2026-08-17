import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { DocumentType } from '#core/domain/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentTypesSection } from './DocumentTypesSection.js';

describe('DocumentTypesSection', () => {
  it('lists, adds and renames tenant document types', async () => {
    let rows: DocumentType[] = [
      { slug: 'umowa-uod', label: 'Umowa UoD', position: 10, hidden: false },
      { slug: 'inny', label: 'Inny', position: 50, hidden: false },
    ];
    const create = vi.fn();
    const rename = vi.fn();
    server.use(
      http.get('*/api/document-types', () =>
        HttpResponse.json({ ok: true, data: { documentTypes: rows } }),
      ),
      http.post('*/api/document-types', async ({ request }) => {
        const body = await request.json();
        create(body);
        const created = {
          slug: 'umowa-z-klientem',
          label: 'Umowa z klientem',
          position: 60,
          hidden: false,
        };
        rows = [...rows, created];
        return HttpResponse.json({ ok: true, data: { documentType: created } });
      }),
      http.patch('*/api/document-types/:slug', async ({ params, request }) => {
        const body = await request.json();
        rename(params.slug, body);
        const renamed = {
          slug: String(params.slug),
          label: 'Pozostałe',
          position: 50,
          hidden: false,
        };
        rows = rows.map((row) => row.slug === params.slug ? renamed : row);
        return HttpResponse.json({ ok: true, data: { documentType: renamed } });
      }),
    );

    renderWithProviders(<DocumentTypesSection />);
    expect(await screen.findByText('Umowa UoD')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nazwa typu'), 'Umowa z klientem');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ label: 'Umowa z klientem' }));
    expect(await screen.findByText('Umowa z klientem')).toBeInTheDocument();

    const innyRow = screen.getByText('Inny').closest('li');
    if (!innyRow) throw new Error('Missing document type row');
    await userEvent.click(within(innyRow).getByRole('button', { name: 'Zmień nazwę' }));
    const editInput = within(innyRow).getByLabelText('Nazwa typu');
    await userEvent.clear(editInput);
    await userEvent.type(editInput, 'Pozostałe');
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith('inny', { label: 'Pozostałe' }));
    expect(await screen.findByText('Pozostałe')).toBeInTheDocument();
  });

  it('surfaces a conflict when a used type cannot be deleted', async () => {
    server.use(
      http.delete('*/api/document-types/:slug', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'conflict', message: 'Typ jest używany' } },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<DocumentTypesSection />);
    await userEvent.click(await screen.findByLabelText('Usuń typ Umowa UoD'));
    expect(await screen.findByText('Typ jest używany')).toBeInTheDocument();
  });

  it('hides and restores a type without touching its documents', async () => {
    let rows: DocumentType[] = [
      { slug: 'umowa-uod', label: 'Umowa UoD', position: 10, hidden: false },
      { slug: 'inny', label: 'Inny', position: 50, hidden: true },
    ];
    const setHidden = vi.fn();
    server.use(
      http.get('*/api/document-types', () =>
        HttpResponse.json({ ok: true, data: { documentTypes: rows } }),
      ),
      http.patch('*/api/document-types/:slug/hidden', async ({ params, request }) => {
        const body = await request.json();
        setHidden(params.slug, body);
        const { hidden } = z.object({ hidden: z.boolean() }).parse(body);
        rows = rows.map((row) => (row.slug === params.slug ? { ...row, hidden } : row));
        const updated = rows.find((row) => row.slug === params.slug);
        return HttpResponse.json({ ok: true, data: { documentType: updated } });
      }),
    );

    renderWithProviders(<DocumentTypesSection />);
    const umowaRow = (await screen.findByText('Umowa UoD')).closest('li');
    if (!umowaRow) throw new Error('Missing document type row');
    await userEvent.click(within(umowaRow).getByRole('button', { name: 'Ukryj' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledWith('umowa-uod', { hidden: true }));

    const innyRow = screen.getByText('Inny').closest('li');
    if (!innyRow) throw new Error('Missing document type row');
    await userEvent.click(within(innyRow).getByRole('button', { name: 'Przywróć' }));
    await waitFor(() => expect(setHidden).toHaveBeenCalledWith('inny', { hidden: false }));
  });
});
