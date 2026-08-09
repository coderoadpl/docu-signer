import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { documentCreateInputSchema } from '#core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentsPage } from './DocumentsPage.js';
import { documentsSearchSchema } from './documents.logic.js';

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

const trashedDocument = {
  ...document,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Usunięta uchwała',
  docType: 'uchwala',
  person: 'Piotr Zieliński',
  deletedAt: '2026-08-02T09:00:00.000Z',
};

const renderPage = async (initialEntry = '/app/documents') => {
  const root = createRootRoute();
  const list = createRoute({
    getParentRoute: () => root,
    path: '/app/documents',
    validateSearch: documentsSearchSchema,
    component: DocumentsPage,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id',
    validateSearch: documentsSearchSchema,
    component: () => <div>Szczegóły dokumentu</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

const dateField = (container: HTMLElement, name: string) =>
  within(container).getByRole('group', { name: new RegExp(name, 'u') });

const pasteDate = async (field: HTMLElement, value: string) => {
  await userEvent.click(field);
  await userEvent.paste(value);
  await waitFor(() => expect(field).toHaveTextContent(value));
};

const clearDateWithButton = async (field: HTMLElement) => {
  await userEvent.click(within(field).getByRole('button', { name: 'Wyczyść' }));
  await waitFor(() => expect(field).toHaveTextContent('DD.MM.YYYY'));
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
    fireEvent.change(screen.getByLabelText('Szukaj po tytule'), {
      target: { value: 'Protokół' },
    });

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
    const draft = {
      ...document,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Szkic importu',
      draft: true,
    };
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        if (params.get('draft') === 'true') {
          return HttpResponse.json({ ok: true, data: { documents: [draft] } });
        }
        if (params.get('signatureStatus') === 'signed') {
          return HttpResponse.json({ ok: true, data: { documents: [signed] } });
        }
        return HttpResponse.json({ ok: true, data: { documents: [document, signed, draft] } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    fireEvent.change(screen.getByRole('combobox', { name: 'Osoba' }), {
      target: { value: 'Anna' },
    });
    await userEvent.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ person: 'Anna Nowak' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: 'podpis' },
    });
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

    await userEvent.click(screen.getByLabelText('Szkice'));
    await userEvent.click(await screen.findByRole('option', { name: 'Tylko szkice' }));
    expect((await screen.findAllByText('Szkic importu')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Szkic').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        person: 'Anna Nowak',
        tag: 'podpisane',
        signatureStatus: 'signed',
        draft: 'true',
      }),
    );
  });

  it('restores filter controls from a deep link', async () => {
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('draft') !== 'all') seen(Object.fromEntries(params.entries()));
        return HttpResponse.json({ ok: true, data: { documents: [document] } });
      }),
    );
    await renderPage(
      '/app/documents?q=umowa&typ=umowa-uod&osoba=Anna&tag=ważne&status=needs-signature&szkice=true&od=2026-01-01&do=2026-12-31',
    );

    expect(await screen.findByLabelText('Szukaj po tytule')).toHaveValue('umowa');
    expect(screen.getByRole('combobox', { name: 'Osoba' })).toHaveValue('Anna');
    expect(screen.getByRole('combobox', { name: 'Tag' })).toHaveValue('ważne');
    expect(screen.getByText('Do podpisania')).toBeInTheDocument();
    expect(screen.getByText('Tylko szkice')).toBeInTheDocument();
    expect(dateField(window.document.body, 'Od')).toHaveTextContent('01.01.2026');
    expect(dateField(window.document.body, 'Do')).toHaveTextContent('31.12.2026');
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        text: 'umowa',
        docType: 'umowa-uod',
        person: 'Anna',
        tag: 'ważne',
        signatureStatus: 'needs-signature',
        draft: 'true',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      }),
    );
  });

  it('restores non-list tabs from deep links', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
    );
    await renderPage('/app/documents?tab=os-czasu&tag=ważne');

    expect(
      await screen.findByRole('tab', { name: 'Os czasu', selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Os czasu' })).toBeInTheDocument();
  });

  it('keeps the draft-filtered list after a detail roundtrip', async () => {
    const seen = vi.fn();
    const draft = {
      ...document,
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Szkic importu',
      draft: true,
    };
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('draft') !== 'all') seen(Object.fromEntries(params.entries()));
        return HttpResponse.json({ ok: true, data: { documents: [draft] } });
      }),
    );
    const { router } = await renderPage('/app/documents?szkice=true&q=Szkic');

    expect((await screen.findAllByText('Szkic importu')).length).toBeGreaterThan(0);
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ text: 'Szkic', draft: 'true' }));
    const firstTitle = screen.getAllByText('Szkic importu').at(0);
    if (!firstTitle) throw new Error('Missing draft title');
    await userEvent.click(firstTitle);
    expect(await screen.findByText('Szczegóły dokumentu')).toBeInTheDocument();

    router.history.back();

    expect((await screen.findAllByText('Szkic importu')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Szukaj po tytule')).toHaveValue('Szkic');
    expect(screen.getByText('Tylko szkice')).toBeInTheDocument();
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ q: 'Szkic', szkice: 'true' }),
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
    const { router } = await renderPage();

    await screen.findAllByText('Umowa z Anną');
    fireEvent.change(screen.getByLabelText('Szukaj po tytule'), {
      target: { value: 'brak' },
    });
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
    expect(requests).toHaveBeenCalledTimes(3);
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

  it('persists column visibility and order and filters from tag chips', async () => {
    const seen = vi.fn();
    const saved = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        return HttpResponse.json({ ok: true, data: { documents: [document] } });
      }),
      http.get('/api/me/preferences/documents.columns', () =>
        HttpResponse.json({
          ok: true,
          data: {
            preference: {
              userId: 'user-1',
              key: 'documents.columns',
              value: {
                order: ['title', 'tags', 'files'],
                visible: ['title', 'tags'],
              },
              updatedAt: '2026-08-02T10:00:00.000Z',
            },
          },
        }),
      ),
      http.put('/api/me/preferences/documents.columns', async ({ request }) => {
        const body = await request.json();
        saved(body);
        return HttpResponse.json({
          ok: true,
          data: {
            preference: {
              userId: 'user-1',
              key: 'documents.columns',
              value: typeof body === 'object' && body && 'value' in body ? body.value : null,
              updatedAt: '2026-08-02T10:05:00.000Z',
            },
          },
        });
      }),
    );
    await renderPage();

    expect(await screen.findByRole('columnheader', { name: 'Tagi' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Data podpisania' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('ważne'));
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ tag: 'ważne' }));

    await userEvent.click(screen.getByRole('button', { name: 'Kolumny' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pliki' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        value: {
          order: [
            'title',
            'tags',
            'files',
            'documentDate',
            'docType',
            'person',
            'period',
            'signatureStatus',
            'draft',
          ],
          visible: ['title', 'tags', 'files'],
        },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Przesuń w górę: Tagi' }));
    await waitFor(() =>
      expect(saved).toHaveBeenLastCalledWith({
        value: {
          order: [
            'tags',
            'title',
            'files',
            'documentDate',
            'docType',
            'person',
            'period',
            'signatureStatus',
            'draft',
          ],
          visible: ['title', 'tags', 'files'],
        },
      }),
    );
  });

  it('shows bulk progress and summarizes partial failures', async () => {
    const updates = vi.fn();
    const releaseFirst: { current: (() => void) | null } = { current: null };
    const firstUpdate = new Promise<void>((resolve) => {
      releaseFirst.current = resolve;
    });
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
      http.patch('/api/documents/:id', async ({ params, request }) => {
        updates(params.id, await request.json());
        if (params.id === DOCUMENT_ID) {
          await firstUpdate;
          return HttpResponse.json({ ok: true, data: { document } });
        }
        return HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'Błąd zapisu' } },
          { status: 500 },
        );
      }),
    );
    await renderPage();

    await screen.findAllByText('Uchwała zarządu');
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Umowa z Anną' }).at(0) ??
        screen.getByLabelText('Zaznacz dokument: Umowa z Anną'),
    );
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Uchwała zarządu' }).at(0) ??
        screen.getByLabelText('Zaznacz dokument: Uchwała zarządu'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ustaw osobę' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ustaw osobę' });
    expect(within(dialog).getByText('Nadpiszesz osobę w 2 dokumentach.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Osoba' }), 'Jan Kowalski');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zastosuj' }));

    expect(await screen.findByLabelText('Postęp operacji zbiorczej')).toBeInTheDocument();
    if (!releaseFirst.current) throw new Error('Missing pending update release');
    releaseFirst.current();
    expect(
      await screen.findByText('Operacje zbiorcze: 1 zmieniono, 1 błędów.'),
    ).toBeInTheDocument();
    expect(updates).toHaveBeenCalledWith(
      DOCUMENT_ID,
      expect.objectContaining({ person: 'Jan Kowalski' }),
    );
  });

  it('opens the row overflow menu and moves a document to trash', async () => {
    const remove = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.delete('/api/documents/:id', ({ params }) => {
        remove(params.id);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    await userEvent.click(
      screen.getByRole('button', { name: 'Więcej akcji dla dokumentu Umowa z Anną' }),
    );
    expect(screen.getByRole('menuitem', { name: 'Otwórz' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Do kosza' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(DOCUMENT_ID));
  });

  it('saves, applies and deletes teczki presets', async () => {
    const seen = vi.fn();
    const savedCreate = vi.fn();
    const savedDelete = vi.fn();
    const savedSearch = {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: 'tenant-1',
      name: 'Odbiór',
      filter: { tag: 'odbiór', signatureStatus: 'signed', draft: 'all' },
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: 'odbiór' },
    });
    await userEvent.click(screen.getByLabelText('Status podpisu'));
    await userEvent.click(await screen.findByRole('option', { name: 'Podpisane' }));
    await userEvent.click(screen.getByLabelText('Szkice'));
    await userEvent.click(await screen.findByRole('option', { name: 'Wszystkie' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz teczkę' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zapisz teczkę' });
    expect(
      within(dialog).getByText('Tag: odbiór · Status podpisu: Podpisane · Szkice: razem z zatwierdzonymi'),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Nazwa'), {
      target: { value: 'Odbiór' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz teczkę' }));

    await waitFor(() =>
      expect(savedCreate).toHaveBeenCalledWith({
        name: 'Odbiór',
        filter: { tag: 'odbiór', signatureStatus: 'signed', draft: 'all' },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Zapisz teczkę' })).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: '' },
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Teczki' }));
    expect(await screen.findByRole('heading', { name: 'Odbiór' })).toBeInTheDocument();
    expect(screen.getByText('Tag: odbiór · Status podpisu: Podpisane · Szkice: razem z zatwierdzonymi')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('heading', { name: 'Odbiór' }));
    expect((await screen.findAllByText('Protokół odbioru')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        tag: 'odbiór',
        signatureStatus: 'signed',
        draft: 'all',
      }),
    );
    expect(router.state.location.search).toMatchObject({
      tag: 'odbiór',
      status: 'signed',
      szkice: 'all',
    });

    await userEvent.click(await screen.findByRole('tab', { name: 'Teczki' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));
    expect(screen.getByRole('button', { name: 'Potwierdź' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() =>
      expect(savedDelete).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'),
    );
  });

  it('lists trash and restores a trashed document', async () => {
    const restore = vi.fn();
    let trash = [trashedDocument];
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({ ok: true, data: { documents: trash } }),
      ),
      http.post('/api/documents/:id/restore', ({ params }) => {
        restore(params.id);
        trash = [];
        return HttpResponse.json({
          ok: true,
          data: { document: { ...trashedDocument, deletedAt: null } },
        });
      }),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Kosz' }));
    expect(await screen.findAllByText('Usunięta uchwała')).toHaveLength(2);
    expect(screen.getAllByText('Uchwała').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Piotr Zieliński').length).toBeGreaterThan(0);
    expect(screen.getByText('Usunięto: 02.08.2026')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Przywróć' }).at(0) ?? screen.getByText('Przywróć'));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'),
    );
    expect(await screen.findByRole('heading', { name: 'Kosz jest pusty' })).toBeInTheDocument();
  });

  it('purges one trashed document after a hard-delete confirmation', async () => {
    const purge = vi.fn();
    let trash = [trashedDocument];
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({ ok: true, data: { documents: trash } }),
      ),
      http.delete('/api/documents/:id/purge', ({ params }) => {
        purge(params.id);
        trash = [];
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Kosz' }));
    await screen.findAllByText('Usunięta uchwała');
    await userEvent.click(screen.getAllByRole('button', { name: 'Usuń trwale' }).at(0) ?? screen.getByText('Usuń trwale'));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć trwale?' });
    expect(within(dialog).getByText(/magazynu blob/u)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń trwale' }));

    await waitFor(() =>
      expect(purge).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'),
    );
    expect(await screen.findByText('Kosz: 1 usunięto, 0 błędów.')).toBeInTheDocument();
  });

  it('empties all trashed documents with typed confirmation and a summary', async () => {
    const purge = vi.fn();
    let trash = [
      trashedDocument,
      {
        ...trashedDocument,
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Usunięty rachunek',
        docType: 'rachunek',
      },
    ];
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({ ok: true, data: { documents: trash } }),
      ),
      http.delete('/api/documents/:id/purge', ({ params }) => {
        purge(params.id);
        trash = trash.filter((item) => item.id !== params.id);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Kosz' }));
    expect(await screen.findAllByText('Usunięta uchwała')).toHaveLength(2);
    expect(await screen.findAllByText('Usunięty rachunek')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Opróżnij kosz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opróżnić kosz?' });
    const confirm = within(dialog).getByLabelText('Wpisz OPRÓŻNIJ KOSZ');
    expect(within(dialog).getByRole('button', { name: 'Opróżnij kosz' })).toBeDisabled();
    fireEvent.change(confirm, { target: { value: 'OPRÓŻNIJ KOSZ' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Opróżnij kosz' }));

    await waitFor(() => expect(purge).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Kosz: 2 usunięto, 0 błędów.')).toBeInTheDocument();
    expect(screen.getByText('Kosz jest pusty. Kosz nigdy nie opróżnia się sam.')).toBeInTheDocument();
  });

  it('reports trash restore and empty-all failures without auto-clearing the trash', async () => {
    let trash = [
      trashedDocument,
      {
        ...trashedDocument,
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Usunięty rachunek',
        docType: 'rachunek',
      },
    ];
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({ ok: true, data: { documents: trash } }),
      ),
      http.post('/api/documents/:id/restore', () =>
        HttpResponse.json(
          {
            ok: false,
            error: { code: 'internal', message: 'Nie udało się przywrócić' },
          },
          { status: 500 },
        ),
      ),
      http.delete('/api/documents/:id/purge', ({ params }) => {
        if (params.id === '22222222-2222-4222-8222-222222222222') {
          return HttpResponse.json(
            {
              ok: false,
              error: { code: 'internal', message: 'Nie udało się usunąć' },
            },
            { status: 500 },
          );
        }
        trash = trash.filter((item) => item.id !== params.id);
        return HttpResponse.json({ ok: true, data: { deleted: true } });
      }),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Kosz' }));
    await screen.findAllByText('Usunięta uchwała');
    await userEvent.click(screen.getAllByRole('button', { name: 'Przywróć' }).at(0) ?? screen.getByText('Przywróć'));
    expect(await screen.findByText('Nie udało się przywrócić')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Opróżnij kosz' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opróżnić kosz?' });
    fireEvent.change(within(dialog).getByLabelText('Wpisz OPRÓŻNIJ KOSZ'), {
      target: { value: 'OPRÓŻNIJ KOSZ' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Opróżnij kosz' }));

    expect(await screen.findByText('Kosz: 1 usunięto, 1 błędów.')).toBeInTheDocument();
    expect(screen.getAllByText('Usunięta uchwała').length).toBeGreaterThan(0);
  });

  it('shows the non-auto-empty trash copy when Kosz is empty', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
      http.get('/api/documents/trash', () =>
        HttpResponse.json({ ok: true, data: { documents: [] } }),
      ),
    );
    await renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Kosz' }));
    expect(await screen.findByRole('heading', { name: 'Kosz jest pusty' })).toBeInTheDocument();
    expect(screen.getByText('Kosz jest pusty. Kosz nigdy nie opróżnia się sam.')).toBeInTheDocument();
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
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tytuł' }), {
      target: { value: 'Nowy dokument' },
    });
    expect(dateField(dialog, 'Data podpisania')).toHaveTextContent('DD.MM.YYYY');
    await userEvent.click(within(dialog).getByText('Okres'));
    const periodStart = dateField(dialog, 'Od');
    const periodEnd = dateField(dialog, 'Do');
    await pasteDate(periodStart, '01.07.2026');
    expect(dateField(dialog, 'Data podpisania')).toHaveTextContent('01.07.2026');
    await pasteDate(periodEnd, '30.06.2026');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Dodaj dokument' }),
    );
    expect(
      within(dialog).getByText(
        'Data końcowa nie może być wcześniejsza niż początkowa',
      ),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await clearDateWithButton(periodEnd);
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Osoba' }), {
      target: { value: 'Anna Nowak' },
    });
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

    fireEvent.change(title, { target: { value: 'Nowy dokument' } });
    const date = dateField(dialog, 'Data podpisania');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Dodaj dokument' }),
    );
    expect(date).toHaveAccessibleDescription('Data podpisania jest wymagana');
  });
});
