import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { documentCreateInputSchema } from '#core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentsPage } from './DocumentsPage.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

const document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa z Anną',
  docType: 'umowa-uod',
  documentDate: '2026-07-18',
  periodStart: null,
  periodEnd: null,
  person: 'Anna Nowak',
  tags: ['ważne'],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  files: [],
};

const renderPage = async () => {
  const root = createRootRoute();
  const list = createRoute({
    getParentRoute: () => root,
    path: '/app/documents',
    component: DocumentsPage,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id',
    component: () => <div>Szczegóły dokumentu</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: ['/app/documents'] }),
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
          data: {
            documents:
              text === 'Protokół'
                ? [{ ...document, title: 'Protokół odbioru' }]
                : [document],
          },
        });
      }),
    );
    await renderPage();

    expect((await screen.findAllByText('Umowa z Anną')).length).toBeGreaterThan(0);
    await userEvent.type(
      screen.getByLabelText('Szukaj po tytule'),
      'Protokół',
    );

    expect((await screen.findAllByText('Protokół odbioru')).length).toBeGreaterThan(0);
    await waitFor(() => expect(seen).toHaveBeenCalledWith('Protokół'));
  });

  it('filters by person and tag autocomplete suggestions and signature status', async () => {
    const seen = vi.fn();
    const signed = {
      ...document,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Podpisana umowa',
      tags: ['podpisane'],
      files: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          documentId: '22222222-2222-4222-8222-222222222222',
          role: 'signed-digital',
          fileName: 'podpis.pdf',
          contentType: 'application/pdf',
          sizeBytes: 3,
          storageKey: 'documents/tenant/doc/file',
          createdAt: '2026-07-18T10:00:00.000Z',
        },
      ],
    };
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        if (params.get('signatureStatus') === 'signed') {
          return HttpResponse.json({ ok: true, data: { documents: [signed] } });
        }
        return HttpResponse.json({ ok: true, data: { documents: [document, signed] } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    await userEvent.click(screen.getByLabelText('Osoba'));
    await userEvent.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ person: 'Anna Nowak' }));

    await userEvent.click(screen.getByLabelText('Tag'));
    await userEvent.click(await screen.findByRole('option', { name: 'podpisane' }));
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        person: 'Anna Nowak',
        tag: 'podpisane',
      }),
    );

    await userEvent.click(screen.getByLabelText('Status podpisu'));
    await userEvent.click(await screen.findByRole('option', { name: 'Podpisane' }));
    expect((await screen.findAllByText('Podpisana umowa')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        person: 'Anna Nowak',
        tag: 'podpisane',
        signatureStatus: 'signed',
      }),
    );
  });

  it('shows one dominant create action and no tools for an empty archive', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } }),
      ),
    );
    await renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Brak dokumentów' }),
    ).toBeInTheDocument();

    expect(screen.queryByLabelText('Szukaj po tytule')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eksportuj zaznaczone/ })).not.toBeInTheDocument();
    const emptyStateCta = screen.getByRole('button', { name: 'Dodaj dokument' });
    await userEvent.click(emptyStateCta);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Anuluj' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('distinguishes filtered zero results and clears the filters', async () => {
    server.use(
      http.get('/api/documents', ({ request }) => {
        const text = new URL(request.url).searchParams.get('text');
        return HttpResponse.json({
          ok: true,
          data: { documents: text ? [] : [document] },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    await userEvent.type(screen.getByLabelText('Szukaj po tytule'), 'brak');
    expect(
      await screen.findByRole('heading', {
        name: 'Brak wyników dla tych filtrów',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dodaj pierwszy dokument do archiwum.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    expect((await screen.findAllByText('Umowa z Anną')).length).toBeGreaterThan(0);
  });

  it('surfaces a failed documents query and retries it', async () => {
    const requests = vi.fn();
    server.use(
      http.get('/api/documents', () => {
        requests();
        return requests.mock.calls.length === 1
          ? HttpResponse.json(
              {
                ok: false,
                error: { code: 'internal', message: 'Nie udało się pobrać' },
              },
              { status: 500 },
            )
          : HttpResponse.json({
              ok: true,
              data: { documents: [document] },
            });
      }),
    );
    await renderPage();

    expect(await screen.findByText('Nie udało się pobrać')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Spróbuj ponownie' }),
    );

    expect((await screen.findAllByText('Umowa z Anną')).length).toBeGreaterThan(0);
    expect(requests).toHaveBeenCalledTimes(2);
  });

  it('enables bulk export as documents are selected', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              document,
              {
                ...document,
                id: '22222222-2222-4222-8222-222222222222',
                title: 'Uchwała zarządu',
              },
            ],
          },
        }),
      ),
    );
    await renderPage();

    await screen.findAllByText('Uchwała zarządu');
    const emptyExport = await screen.findByRole('button', {
      name: 'Eksportuj zaznaczone (0)',
    });
    expect(emptyExport).toBeDisabled();
    const annaCheckbox = screen
      .getAllByRole('checkbox', {
        name: 'Zaznacz dokument: Umowa z Anną',
      })
      .at(0);
    if (!annaCheckbox) throw new Error('Missing document checkbox');
    await userEvent.click(annaCheckbox);
    expect(
      screen.getByRole('button', { name: 'Eksportuj zaznaczone (1)' }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Zaznacz wszystkie dokumenty',
      }),
    );
    expect(
      screen.getByRole('button', { name: 'Eksportuj zaznaczone (2)' }),
    ).toBeEnabled();
  });

  it('saves, applies and deletes teczki presets', async () => {
    const seen = vi.fn();
    const savedCreate = vi.fn();
    const savedDelete = vi.fn();
    const savedSearch = {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: 'tenant-1',
      name: 'Odbiór',
      filter: { tag: 'odbiór', signatureStatus: 'signed' },
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    let savedSearches: Array<typeof savedSearch> = [];
    const protocol = {
      ...document,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Protokół odbioru',
      docType: 'protokol',
      documentDate: '2026-01-15',
      periodStart: '2025-12-15',
      periodEnd: '2026-01-15',
      tags: ['odbiór'],
    };
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        if (params.get('tag') === 'odbiór') {
          return HttpResponse.json({ ok: true, data: { documents: [protocol] } });
        }
        if (params.get('dateFrom') === '2025-01-01') {
          return HttpResponse.json({ ok: true, data: { documents: [protocol] } });
        }
        return HttpResponse.json({
          ok: true,
          data: { documents: [document, protocol] },
        });
      }),
      http.get('/api/saved-searches', () =>
        HttpResponse.json({ ok: true, data: { savedSearches } }),
      ),
      http.post('/api/saved-searches', async ({ request }) => {
        const body = await request.json();
        savedCreate(body);
        savedSearches = [savedSearch];
        return HttpResponse.json({ ok: true, data: { savedSearch } });
      }),
      http.delete('/api/saved-searches/:id', ({ params }) => {
        savedDelete(params.id);
        savedSearches = [];
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    expect(screen.getByLabelText('Tag')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Tag'), 'odbiór');
    await userEvent.click(screen.getByLabelText('Status podpisu'));
    await userEvent.click(await screen.findByRole('option', { name: 'Podpisane' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz teczkę' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zapisz teczkę' });
    expect(
      within(dialog).getByText('Tag: odbiór · Status podpisu: Podpisane'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Nazwa'), 'Odbiór');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz teczkę' }));

    await waitFor(() =>
      expect(savedCreate).toHaveBeenCalledWith({
        name: 'Odbiór',
        filter: { tag: 'odbiór', signatureStatus: 'signed' },
      }),
    );
    await userEvent.clear(screen.getByLabelText('Tag'));
    await userEvent.click(await screen.findByRole('tab', { name: 'Teczki' }));
    expect(await screen.findByRole('heading', { name: 'Odbiór' })).toBeInTheDocument();
    expect(screen.getByText('Tag: odbiór · Status podpisu: Podpisane')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('heading', { name: 'Odbiór' }));
    expect((await screen.findAllByText('Protokół odbioru')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        tag: 'odbiór',
        signatureStatus: 'signed',
      }),
    );

    await userEvent.click(await screen.findByRole('tab', { name: 'Teczki' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));
    expect(screen.getByRole('button', { name: 'Potwierdź' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() =>
      expect(savedDelete).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'),
    );
  });

  it('creates a document and navigates to its detail', async () => {
    const create = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } }),
      ),
      http.post('/api/documents', async ({ request }) => {
        const input = documentCreateInputSchema.parse(await request.json());
        create(input);
        return HttpResponse.json({
          ok: true,
          data: { document: { ...document, ...input } },
        });
      }),
    );
    const { router } = await renderPage();

    const addButton = (
      await screen.findAllByRole('button', { name: 'Dodaj dokument' })
    ).at(0);
    if (!addButton) throw new Error('Missing add document button');
    await userEvent.click(addButton);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Tytuł' }),
      'Nowy dokument',
    );
    expect(within(dialog).getByLabelText('Data podpisania')).toHaveValue('');
    await userEvent.click(within(dialog).getByText('Okres'));
    await userEvent.type(within(dialog).getByLabelText('Od'), '2026-07-01');
    expect(within(dialog).getByLabelText('Data podpisania')).toHaveValue('2026-07-01');
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: 'Osoba' }),
      'Anna Nowak',
    );
    await userEvent.type(
      within(dialog).getByRole('combobox', { name: 'Tagi' }),
      'zarząd,ważne{Enter}',
    );
    expect(within(dialog).getByText('zarząd')).toBeInTheDocument();
    expect(within(dialog).getByText('ważne')).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Dodaj dokument' }),
    );

    expect(await screen.findByText('Szczegóły dokumentu')).toBeInTheDocument();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentDate: '2026-07-01',
        periodStart: '2026-07-01',
        periodEnd: null,
        person: 'Anna Nowak',
        tags: ['zarząd', 'ważne'],
      }),
    );
    expect(router.state.location.pathname).toBe(
      `/app/documents/${DOCUMENT_ID}`,
    );
  });

  it('shows Polish inline validation and focuses the first invalid field', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } }),
      ),
    );
    await renderPage();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Dodaj dokument' }),
    );
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Dodaj dokument' }),
    );

    const title = within(dialog).getByRole('textbox', { name: 'Tytuł' });
    expect(title).toHaveFocus();
    expect(title).toHaveAccessibleDescription('Tytuł jest wymagany');

    await userEvent.type(title, 'Nowy dokument');
    const date = within(dialog).getByLabelText('Data podpisania');
    await userEvent.clear(date);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Dodaj dokument' }),
    );
    expect(date).toHaveFocus();
    expect(date).toHaveAccessibleDescription('Data podpisania jest wymagana');
  });
});
