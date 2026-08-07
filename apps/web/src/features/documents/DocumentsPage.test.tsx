import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { documentCreateInputSchema } from '#core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentsPage } from './DocumentsPage.js';

const document = {
  id: 'document-1',
  tenantId: 'tenant-1',
  title: 'Umowa z Anną',
  docType: 'umowa-uod',
  documentDate: '2026-07-18',
  person: 'Anna Nowak',
  tags: ['ważne'],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  files: [],
};

const renderPage = async () => {
  const root = createRootRoute();
  const list = createRoute({ getParentRoute: () => root, path: '/documents', component: DocumentsPage });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/documents/$id',
    component: () => <div>Szczegóły dokumentu</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: ['/documents'] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

describe('DocumentsPage', () => {
  it('renders server-filtered documents', async () => {
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const text = new URL(request.url).searchParams.get('text');
        seen(text);
        return HttpResponse.json({
          ok: true,
          data: { documents: text === 'Protokół' ? [{ ...document, title: 'Protokół odbioru' }] : [document] },
        });
      }),
    );
    await renderPage();

    expect(await screen.findByText('Umowa z Anną')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Szukaj po tytule'), 'Protokół');

    expect(await screen.findByText('Protokół odbioru')).toBeInTheDocument();
    await waitFor(() => expect(seen).toHaveBeenCalledWith('Protokół'));
  });

  it('filters by type and person and opens the create dialog from the empty state', async () => {
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen({ docType: params.get('docType'), person: params.get('person') });
        return HttpResponse.json({ ok: true, data: { documents: [] } });
      }),
    );
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'Brak dokumentów' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox', { name: 'Typ' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Uchwała' }));
    await userEvent.type(screen.getByLabelText('Osoba'), 'Anna');
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ docType: 'uchwala', person: 'Anna' }));

    const emptyStateCta = screen.getAllByRole('button', { name: 'Dodaj dokument' }).at(-1);
    if (!emptyStateCta) throw new Error('Missing empty-state CTA');
    await userEvent.click(emptyStateCta);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('surfaces a failed documents query as an alert', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: false, error: { code: 'internal', message: 'Nie udało się pobrać' } }, { status: 500 }),
      ),
    );
    await renderPage();

    expect(await screen.findByText('Nie udało się pobrać')).toBeInTheDocument();
  });

  it('enables bulk export as documents are selected', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              document,
              { ...document, id: 'document-2', title: 'Uchwała zarządu' },
            ],
          },
        }),
      ),
    );
    await renderPage();

    await screen.findByText('Uchwała zarządu');
    const emptyExport = screen.getByRole('button', { name: 'Eksportuj zaznaczone (0)' });
    expect(emptyExport).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz dokument: Umowa z Anną' }));
    expect(screen.getByRole('button', { name: 'Eksportuj zaznaczone (1)' })).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    expect(screen.getByRole('button', { name: 'Eksportuj zaznaczone (2)' })).toBeEnabled();
  });

  it('creates a document from the dialog and navigates to detail', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } }),
      ),
      http.post('/api/documents', async ({ request }) => {
        const input = documentCreateInputSchema.parse(await request.json());
        return HttpResponse.json({ ok: true, data: { document: { ...document, ...input } } });
      }),
    );
    const { router } = await renderPage();

    const addButtons = await screen.findAllByRole('button', { name: 'Dodaj dokument' });
    const addButton = addButtons.at(0);
    if (!addButton) throw new Error('Missing add document button');
    await userEvent.click(addButton);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tytuł' }), 'Nowy dokument');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj dokument' }));

    expect(await screen.findByText('Szczegóły dokumentu')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/documents/document-1');
  });
});
