import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { documentCreateInputSchema } from '#core/contract/index.js';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentsPage } from './DocumentsPage.js';
import { TrashPage } from './TrashPage.js';
import {
  documentReviewSearchSchema,
  documentSigningSearchSchema,
  documentsSearchSchema,
} from './documents.logic.js';

vi.mock('../../components/ui/PolishDatePicker.js', async () => {
  const React = await import('react');
  const polishDateFromIso = (value: string): string => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return '';
    return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
  };
  const isoDateFromPolish = (value: string): string => {
    if (!/^\d{2}\.\d{2}\.\d{4}$/u.test(value)) return '';
    return `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}`;
  };
  const PolishDatePickerProvider = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const PolishDatePicker = ({
    describedBy,
    helperText,
    inputRef,
    label,
    value,
    onChange,
  }: {
    describedBy?: string | undefined;
    helperText?: string | undefined;
    inputRef?: React.Ref<HTMLInputElement> | undefined;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => {
    const displayValue = polishDateFromIso(value);
    return React.createElement(
      'div',
      { 'aria-describedby': describedBy, 'aria-label': label, role: 'group' },
      React.createElement('input', {
        'aria-label': label,
        'aria-describedby': describedBy,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          onChange(isoDateFromPolish(event.target.value));
        },
        ref: inputRef,
        value: displayValue,
      }),
      React.createElement('button', { onClick: () => onChange(''), type: 'button' }, 'Wyczyść'),
      React.createElement('span', null, displayValue || 'DD.MM.YYYY'),
      helperText ? React.createElement('p', { id: describedBy }, helperText) : null,
    );
  };
  return { PolishDatePicker, PolishDatePickerProvider };
});

vi.mock('./DocumentTimelineView.js', async () => {
  const React = await import('react');
  const DocumentTimelineView = ({
    documents,
    onOpenDocument,
  }: {
    documents: Array<{ id: string; title: string }>;
    onOpenDocument: (documentId: string) => void;
  }) =>
    React.createElement(
      'div',
      { 'aria-label': 'Oś czasu dokumentów', role: 'region' },
      documents.map((item) =>
        React.createElement(
          'button',
          { key: item.id, onClick: () => onOpenDocument(item.id), type: 'button' },
          item.title,
        ),
      ),
    );
  return { DocumentTimelineView };
});

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
  signers: [],
  files: [],
};

const signedDocument = {
  ...document,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Podpisana umowa',
  tags: ['podpisane'],
  signers: [{ accountId: 'account-mc', name: 'Mateusz Choma' }],
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

const draftDocument = {
  ...document,
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Szkic importu',
  draft: true,
};

const signatureWaivedDocument = {
  ...document,
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Rachunek bez podpisu',
  docType: 'rachunek',
  signatureNotRequired: true,
};

const savedSearch = {
  id: '33333333-3333-4333-8333-333333333333',
  tenantId: 'tenant-1',
  name: 'Odbiór',
  filter: { tag: 'odbiór', signatureStatus: 'signed', draft: 'all' },
  createdAt: '2026-08-01T00:00:00.000Z',
};

const protocolDocument = {
  ...document,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Protokół odbioru',
  docType: 'protokol',
  documentDate: '2026-01-15',
  periodStart: '2025-12-15',
  periodEnd: '2026-01-15',
  tags: ['odbiór'],
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
  const signing = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id/sign/$fileId',
    validateSearch: documentSigningSearchSchema,
    component: () => <div>Podpisywanie dokumentu</div>,
  });
  const review = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id/review',
    validateSearch: documentReviewSearchSchema,
    component: () => <div>Przeglądanie dokumentu</div>,
  });
  const trash = createRoute({
    getParentRoute: () => root,
    path: '/app/kosz',
    component: TrashPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, detail, signing, review, trash]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

const dateField = (container: HTMLElement, name: string) =>
  within(container).getByRole('group', { name: new RegExp(name, 'u') });

const pasteDate = async (field: HTMLElement, value: string) => {
  fireEvent.change(within(field).getByRole('textbox'), { target: { value } });
  await waitFor(() => expect(field).toHaveTextContent(value));
};

const clearDateWithButton = async (field: HTMLElement) => {
  await userEvent.click(within(field).getByRole('button', { name: 'Wyczyść' }));
  await waitFor(() => expect(field).toHaveTextContent('DD.MM.YYYY'));
};

const openBulkMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Więcej' }));
};

afterEach(() => {
  vi.useRealTimers();
});

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

    expect(
      await screen.findByRole('rowheader', { name: 'Umowa z Anną' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Umowa z Anną$/u })).toHaveAttribute(
      'href',
      `/app/documents/${DOCUMENT_ID}`,
    );
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    fireEvent.change(screen.getByLabelText('Szukaj po tytule'), {
      target: { value: 'Proto' },
    });
    fireEvent.change(screen.getByLabelText('Szukaj po tytule'), {
      target: { value: 'Protokół' },
    });

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalledWith('Proto');
    expect(seen).not.toHaveBeenCalledWith('Protokół');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(seen).not.toHaveBeenCalledWith('Protokół');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    expect(
      await screen.findByRole('rowheader', { name: 'Protokół odbioru' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(seen).toHaveBeenCalledWith('Protokół'));
  });

  it('renders a document without an assigned person', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [{ ...document, person: null }] },
        }),
      ),
    );
    await renderPage();

    expect((await screen.findAllByText('—')).length).toBeGreaterThan(0);
  });

  it('shows a pending-drafts dot with a Polish count tooltip', async () => {
    const user = userEvent.setup();
    const label = '1 propozycja zmian, 2 komentarze-szkice, 1 powiązanie-szkic';
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              {
                ...document,
                pendingDrafts: { comments: 2, links: 1, metadataProposals: 1 },
              },
              { ...signedDocument, pendingDrafts: { comments: 0, links: 0, metadataProposals: 0 } },
            ],
          },
        }),
      ),
    );
    await renderPage();

    const dots = await screen.findAllByLabelText(label);
    expect(dots).toHaveLength(2);
    for (const rendered of dots) {
      const title = rendered.parentElement;
      if (!title) throw new Error('Pending-drafts dot was not rendered inside a title');
      expect(title.firstChild).toBe(rendered);
      expect(title).toHaveTextContent('Umowa z Anną');
      expect(title).toHaveStyle({ alignItems: 'center' });
      expect(rendered).toHaveStyle({
        animation: 'pendingDraftPulse 2s ease-in-out infinite',
      });
    }
    const dot = dots[0];
    if (!dot) throw new Error('Pending-drafts dot was not rendered');
    await user.hover(dot);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
  });

  it('cancels a pending text-filter debounce on unmount', async () => {
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        seen(new URL(request.url).searchParams.get('text'));
        return HttpResponse.json({ ok: true, data: { documents: [document] } });
      }),
    );
    const { unmount } = await renderPage();

    expect((await screen.findAllByText('Umowa z Anną')).length).toBeGreaterThan(0);
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    fireEvent.change(screen.getByLabelText('Szukaj po tytule'), {
      target: { value: 'Protokół' },
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(seen).not.toHaveBeenCalledWith('Protokół');
  });

  it('filters by person and tag autocomplete suggestions', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        return HttpResponse.json({
          ok: true,
          data: { documents: [document, signedDocument, draftDocument] },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    fireEvent.change(screen.getByRole('combobox', { name: 'Strona' }), {
      target: { value: 'Anna' },
    });
    await user.click(await screen.findByRole('option', { name: 'Anna Nowak' }));
    await waitFor(() => expect(seen).toHaveBeenCalledWith({ person: 'Anna Nowak' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: 'podpis' },
    });
    await user.click(await screen.findByRole('option', { name: 'podpisane' }));
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        person: 'Anna Nowak',
        tag: 'podpisane',
      }),
    );

  });

  it('filters by signature and draft status', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    server.use(
      http.get('/api/documents', ({ request }) => {
        const params = new URL(request.url).searchParams;
        seen(Object.fromEntries(params.entries()));
        if (params.get('draft') === 'true') {
          return HttpResponse.json({ ok: true, data: { documents: [draftDocument] } });
        }
        if (params.get('pendingDrafts') === 'true') {
          return HttpResponse.json({ ok: true, data: { documents: [document] } });
        }
        if (params.get('signatureStatus') === 'signed') {
          return HttpResponse.json({ ok: true, data: { documents: [signedDocument] } });
        }
        return HttpResponse.json({
          ok: true,
          data: { documents: [document, signedDocument, draftDocument] },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    await user.click(screen.getByLabelText('Status podpisu'));
    expect(
      await screen.findByRole('option', { name: 'Nie wymaga podpisu' }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: 'Podpisane' }));
    expect((await screen.findAllByText('Podpisana umowa')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        signatureStatus: 'signed',
      }),
    );

    await user.click(screen.getByLabelText('Szkice'));
    await user.click(await screen.findByRole('option', { name: 'Tylko szkice' }));
    expect((await screen.findAllByText('Szkic importu')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Szkic').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        signatureStatus: 'signed',
        draft: 'true',
      }),
    );

    await user.click(screen.getByLabelText('Szkice'));
    await user.click(
      await screen.findByRole('option', { name: 'Z niezatwierdzonymi zmianami' }),
    );
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        signatureStatus: 'signed',
        draft: 'all',
        pendingDrafts: 'true',
      }),
    );
  });

  it('shows the signature-waiver chip in the status column', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [signatureWaivedDocument] },
        }),
      ),
      http.get('/api/me/preferences/documents.columns', () =>
        HttpResponse.json({
          ok: true,
          data: {
            preference: {
              userId: 'user-1',
              key: 'documents.columns',
              value: {
                version: 2,
                order: ['signatureStatus'],
                visible: ['signatureStatus'],
              },
              updatedAt: '2026-08-02T10:00:00.000Z',
            },
          },
        }),
      ),
    );

    await renderPage();

    expect(
      await screen.findByRole('columnheader', { name: 'Status podpisu' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Nie wymaga')).toBeInTheDocument();
  });

  it('renders signer initials with a full-name tooltip and filters by tenant account', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    server.use(
      http.get('/api/tenant-accounts', () =>
        HttpResponse.json({
          ok: true,
          data: { accounts: [{ accountId: 'account-mc', name: 'Mateusz Choma' }] },
        }),
      ),
      http.get('/api/documents', ({ request }) => {
        seen(Object.fromEntries(new URL(request.url).searchParams.entries()));
        return HttpResponse.json({ ok: true, data: { documents: [signedDocument] } });
      }),
    );
    await renderPage();

    expect(await screen.findByRole('columnheader', { name: 'Podpisali' })).toBeInTheDocument();
    const signerChip = screen.getByLabelText('Mateusz Choma');
    expect(signerChip).toHaveTextContent('MC');
    await user.hover(signerChip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Mateusz Choma');

    await user.click(screen.getByLabelText('Podpisał(a)'));
    await user.click(await screen.findByRole('option', { name: 'Mateusz Choma' }));
    await waitFor(() =>
      expect(seen).toHaveBeenCalledWith({ signerAccountId: 'account-mc' }),
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
    expect(screen.getByRole('combobox', { name: 'Strona' })).toHaveValue('Anna');
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

  it('restores the timeline view from deep links', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
    );
    await renderPage('/app/documents?widok=os-czasu&tag=ważne');

    expect(
      await screen.findByRole('button', { name: 'Oś czasu', pressed: true }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: 'Oś czasu dokumentów' }),
    ).toBeInTheDocument();
    expect(dateField(window.document.body, 'Od')).toBeInTheDocument();
    expect(dateField(window.document.body, 'Do')).toBeInTheDocument();
  });

  it('binds timeline documents and opens a selected document', async () => {
    const signedFile = {
      id: '66666666-6666-4666-8666-666666666666',
      documentId: '22222222-2222-4222-8222-222222222222',
      role: 'signed-digital' as const,
      fileName: 'podpis.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12,
      storageKey: 'signed',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const january = {
      ...document,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Styczniowa umowa',
      documentDate: '2026-01-15',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      person: 'Anna Nowak',
      files: [signedFile],
    };
    const march = {
      ...document,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Marcowy protokół',
      docType: 'protokol',
      documentDate: '2026-03-15',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      person: 'Anna Nowak',
      files: [],
    };
    const noPerson = {
      ...document,
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Jednorazowa notatka',
      docType: 'inny',
      documentDate: '2026-02-10',
      periodStart: null,
      periodEnd: null,
      person: null,
      files: [],
    };
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [january, march, noPerson] } }),
      ),
    );
    const { router } = await renderPage('/app/documents?widok=os-czasu');

    const timeline = await screen.findByRole('region', { name: 'Oś czasu dokumentów' });
    expect(within(timeline).getByRole('button', { name: 'Styczniowa umowa' })).toBeInTheDocument();
    expect(within(timeline).getByRole('button', { name: 'Jednorazowa notatka' })).toBeInTheDocument();

    await userEvent.click(
      within(timeline).getByRole('button', { name: 'Marcowy protokół' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/app/documents/33333333-3333-4333-8333-333333333333',
      ),
    );
    expect(router.state.location.search).toMatchObject({ widok: 'os-czasu' });
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
      expect(router.state.location.search).toMatchObject({ q: 'Szkic', szkice: true }),
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

  it('shows only view controls at zero selection and opens the contextual selection bar', async () => {
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
    expect(screen.getByRole('button', { name: 'Lista' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Oś czasu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kolumny' })).toBeInTheDocument();
    expect(screen.queryByText(/Zaznaczono:/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('toolbar', { name: 'Akcje zaznaczonych dokumentów' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Masowe podpisywanie/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Więcej' })).not.toBeInTheDocument();
    const annaCheckbox = screen
      .getAllByRole('checkbox', {
        name: 'Zaznacz dokument: Umowa z Anną',
      })
      .at(0);
    if (!annaCheckbox) throw new Error('Missing document checkbox');
    await userEvent.click(annaCheckbox);
    expect(
      screen.getByRole('toolbar', { name: 'Akcje zaznaczonych dokumentów' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Zaznaczono: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masowe podpisywanie (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Masowe przeglądanie (1)' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zatwierdź (0)' })).toBeDisabled();
    await openBulkMenu();
    expect(screen.getByRole('menuitem', { name: 'Eksportuj zaznaczone (1)' })).toBeEnabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: 'Zaznacz wszystkie dokumenty',
      }),
    );
    expect(screen.getByText('Zaznaczono: 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }));
    expect(screen.queryByText(/Zaznaczono:/u)).not.toBeInTheDocument();
  });

  it('orders the more menu and confirms bulk proposal approval', async () => {
    const approve = vi.fn();
    const listRequests = vi.fn();
    const pendingDocument = {
      ...document,
      pendingDrafts: { comments: 1, links: 1, metadataProposals: 2 },
    };
    const emptyDocument = {
      ...draftDocument,
      pendingDrafts: { comments: 0, links: 0, metadataProposals: 0 },
    };
    let approved = false;
    server.use(
      http.get('/api/documents', () => {
        listRequests();
        return HttpResponse.json({
          ok: true,
          data: {
            documents: [
              approved
                ? { ...pendingDocument, pendingDrafts: emptyDocument.pendingDrafts }
                : pendingDocument,
              emptyDocument,
            ],
          },
        });
      }),
      http.post('/api/document-metadata-proposals/bulk-approve', async ({ request }) => {
        approve(await request.json());
        approved = true;
        return HttpResponse.json({ ok: true, data: { approved: 1, skipped: 1 } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Szkic importu');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await openBulkMenu();
    const menuItems = screen.getAllByRole('menuitem');
    const labels = menuItems.map((item) => item.textContent ?? '');
    const expectedOrder = [
      'Zatwierdź propozycje (1)',
      'Nie wymaga podpisu (2)',
      'Dodaj tagi',
      'Usuń tag',
      'Ustaw stronę',
      'Ustaw typ',
      'Powiąż z dokumentem… (2)',
      'Eksportuj zaznaczone (2)',
      'Do kosza (2)',
    ];
    expect(labels).toEqual(expect.arrayContaining(expectedOrder));
    for (const [index, label] of expectedOrder.entries()) {
      const previous = expectedOrder[index - 1];
      expect(labels.indexOf(label)).toBeGreaterThan(
        previous === undefined ? -1 : labels.indexOf(previous),
      );
    }
    const trashItem = menuItems.at(-1);
    if (!trashItem) throw new Error('Missing trash menu item');
    expect(trashItem).toHaveTextContent('Do kosza (2)');
    expect(getComputedStyle(within(trashItem).getByText('Do kosza (2)')).color).toBe(
      'rgb(211, 47, 47)',
    );

    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Zatwierdź propozycje (1)' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Zatwierdź propozycje' });
    expect(
      within(dialog).getByText(
        'Propozycje zmian zostaną zastosowane w 1 zaznaczonym dokumencie.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Zatwierdź propozycje' }),
    );

    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith({
        documentIds: [document.id, draftDocument.id],
      }),
    );
    expect(
      await screen.findByText('Zatwierdzono propozycje w 1 dokumencie, pominięto 1.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Zaznaczono:/u)).not.toBeInTheDocument();
    await waitFor(() => expect(listRequests.mock.calls.length).toBeGreaterThan(2));
    await waitFor(() =>
      expect(
        screen.queryAllByLabelText(
          '2 propozycje zmian, 1 komentarz-szkic, 1 powiązanie-szkic',
        ),
      ).toHaveLength(0),
    );
  });

  it('bulk links selected documents to one target and skips the target in the selection', async () => {
    const links = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, draftDocument, protocolDocument] },
        }),
      ),
      http.post('/api/documents/:documentId/links', async ({ params, request }) => {
        const input = await request.json();
        links(String(params.documentId), input);
        return HttpResponse.json({
          ok: true,
          data: {
            link: {
              linkId: '77777777-7777-4777-8777-777777777777',
              label: 'podstawa',
              document: protocolDocument,
            },
          },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Protokół odbioru');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }),
    );
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Powiąż z dokumentem… (3)' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Dodaj powiązany dokument',
    });
    await userEvent.click(within(dialog).getByText('Protokół odbioru'));
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Etykieta (opcjonalnie)' }),
      'podstawa',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj' }));

    await waitFor(() => expect(links).toHaveBeenCalledTimes(2));
    expect(links).toHaveBeenCalledWith(document.id, {
      otherDocumentId: protocolDocument.id,
      label: 'podstawa',
    });
    expect(links).toHaveBeenCalledWith(draftDocument.id, {
      otherDocumentId: protocolDocument.id,
      label: 'podstawa',
    });
    expect(links).not.toHaveBeenCalledWith(protocolDocument.id, expect.anything());
    expect(
      await screen.findByText('Powiązano 2, pominięto 1, błędów 0.'),
    ).toBeInTheDocument();
  });

  it('silently skips an already-linked pair in a bulk link action', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, protocolDocument] },
        }),
      ),
      http.post('/api/documents/:documentId/links', () =>
        HttpResponse.json(
          {
            ok: false,
            error: { code: 'conflict', message: 'Documents are already linked' },
          },
          { status: 409 },
        ),
      ),
    );
    await renderPage();

    await screen.findAllByText('Protokół odbioru');
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }),
    );
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Powiąż z dokumentem… (2)' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Dodaj powiązany dokument',
    });
    await userEvent.click(within(dialog).getByText('Protokół odbioru'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj' }));

    expect(
      await screen.findByText('Powiązano 0, pominięto 2, błędów 0.'),
    ).toBeInTheDocument();
  });

  it('disables bulk approve when selected documents contain no drafts', async () => {
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({ ok: true, data: { documents: [document] } }),
      ),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    expect(screen.queryByRole('button', { name: 'Zatwierdź (0)' })).not.toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Umowa z Anną' }).at(0) ??
        screen.getByLabelText('Zaznacz dokument: Umowa z Anną'),
    );

    expect(screen.getByRole('button', { name: 'Zatwierdź (0)' })).toBeDisabled();
  });

  it('bulk approves only selected drafts from a mixed selection', async () => {
    const approve = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              document,
              draftDocument,
              {
                ...draftDocument,
                id: '66666666-6666-4666-8666-666666666666',
                title: 'Drugi szkic',
              },
            ],
          },
        }),
      ),
      http.post('/api/documents/:id/approve', ({ params }) => {
        const id = String(params.id);
        approve(id);
        return HttpResponse.json({
          ok: true,
          data: { document: { ...draftDocument, id, draft: false } },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Drugi szkic');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zatwierdź (2)' }));

    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555'),
    );
    expect(approve).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666');
    expect(approve).not.toHaveBeenCalledWith(DOCUMENT_ID);
    expect(await screen.findByText('Zatwierdzono 2, błędów 0.')).toBeInTheDocument();
  });

  it('bulk reverts only selected approved documents from a mixed selection', async () => {
    const unapprove = vi.fn();
    const secondApproved = {
      ...document,
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Drugi zatwierdzony',
    };
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, secondApproved, draftDocument] },
        }),
      ),
      http.post('/api/documents/:id/unapprove', ({ params }) => {
        const id = String(params.id);
        unapprove(id);
        const current = id === document.id ? document : secondApproved;
        return HttpResponse.json({
          ok: true,
          data: { document: { ...current, draft: true } },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Drugi zatwierdzony');
    expect(screen.queryByRole('button', { name: /Cofnij do szkicu/u })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cofnij do szkicu (2)' }));

    await waitFor(() => expect(unapprove).toHaveBeenCalledWith(DOCUMENT_ID));
    expect(unapprove).toHaveBeenCalledWith('66666666-6666-4666-8666-666666666666');
    expect(unapprove).not.toHaveBeenCalledWith(draftDocument.id);
    expect(await screen.findByText('Cofnięto do szkicu 2, błędów 0.')).toBeInTheDocument();
  });

  it('bulk waives and restores the signature requirement for gated selections', async () => {
    const waive = vi.fn();
    const requireSignature = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, signatureWaivedDocument] },
        }),
      ),
      http.post('/api/documents/:id/waive-signature', ({ params }) => {
        const id = String(params.id);
        waive(id);
        return HttpResponse.json({
          ok: true,
          data: { document: { ...document, id, signatureNotRequired: true } },
        });
      }),
      http.post('/api/documents/:id/require-signature', ({ params }) => {
        const id = String(params.id);
        requireSignature(id);
        return HttpResponse.json({
          ok: true,
          data: {
            document: { ...signatureWaivedDocument, id, signatureNotRequired: false },
          },
        });
      }),
    );
    await renderPage();

    await screen.findAllByText('Rachunek bez podpisu');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await openBulkMenu();
    expect(screen.getByRole('menuitem', { name: 'Nie wymaga podpisu (1)' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Wymaga podpisu (1)' })).toBeEnabled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nie wymaga podpisu (1)' }));
    await waitFor(() => expect(waive).toHaveBeenCalledWith(document.id));
    expect(waive).not.toHaveBeenCalledWith(signatureWaivedDocument.id);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Wymaga podpisu (1)' }));
    await waitFor(() => expect(requireSignature).toHaveBeenCalledWith(signatureWaivedDocument.id));
    expect(requireSignature).not.toHaveBeenCalledWith(document.id);
  });

  it('starts mass signing selected PDFs in canonical grouped order', async () => {
    const baseFile = {
      id: '33333333-3333-4333-8333-333333333333',
      documentId: DOCUMENT_ID,
      role: 'source' as const,
      fileName: 'umowa.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
      storageKey: 'source',
      createdAt: '2026-07-18T10:00:00.000Z',
    };
    const protocolId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const billId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const signedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const signedFileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              {
                ...document,
                id: signedId,
                title: 'Podpisana umowa',
                docType: 'umowa-uod',
                periodStart: '2026-05-01',
                periodEnd: '2026-05-31',
                files: [
                  {
                    ...baseFile,
                    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                    documentId: signedId,
                  },
                  {
                    ...baseFile,
                    id: signedFileId,
                    documentId: signedId,
                    role: 'signed-digital' as const,
                    fileName: 'umowa-podpisany.pdf',
                    createdAt: '2026-07-20T10:00:00.000Z',
                  },
                ],
              },
              {
                ...document,
                id: billId,
                title: 'Rachunek',
                docType: 'rachunek',
                periodStart: '2026-05-01',
                periodEnd: '2026-05-31',
                files: [
                  {
                    ...baseFile,
                    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                    documentId: billId,
                  },
                ],
              },
              {
                ...document,
                id: protocolId,
                title: 'Protokół',
                docType: 'protokol',
                periodStart: '2026-05-01',
                periodEnd: '2026-05-31',
                files: [
                  {
                    ...baseFile,
                    id: '99999999-9999-4999-8999-999999999999',
                    documentId: protocolId,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    const { router } = await renderPage('/app/documents?q=masowe');

    await screen.findByRole('rowheader', { name: 'Podpisana umowa' });
    expect(
      screen.queryByRole('button', { name: 'Masowe podpisywanie (0)' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Masowe przeglądanie (0)' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Podpisana umowa' })[0] ??
        screen.getByLabelText('Zaznacz dokument: Podpisana umowa'),
    );
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Protokół' })[0] ??
        screen.getByLabelText('Zaznacz dokument: Protokół'),
    );
    expect(
      screen.getByRole('button', { name: 'Masowe przeglądanie (2)' }),
    ).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Masowe przeglądanie (2)' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/documents/${signedId}/review`,
      ),
    );
    expect(router.state.location.search).toMatchObject({
      q: 'masowe',
      kolejka: `${signedId},${protocolId}`,
    });

    await act(async () => {
      await router.navigate({ to: '/app/documents', search: { q: 'masowe' } });
    });
    await screen.findByRole('rowheader', { name: 'Podpisana umowa' });
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Podpisana umowa' })[0] ??
        screen.getByLabelText('Zaznacz dokument: Podpisana umowa'),
    );
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: 'Zaznacz dokument: Protokół' })[0] ??
        screen.getByLabelText('Zaznacz dokument: Protokół'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Masowe podpisywanie (2)' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/documents/${signedId}/sign/${signedFileId}`,
      ),
    );
    expect(router.state.location.search).toMatchObject({
      q: 'masowe',
      tryb: 'masowe',
      kolejka: protocolId,
      pliki: '99999999-9999-4999-8999-999999999999',
      podpisane: 0,
      pominiete: 0,
      razem: 2,
    });
  });

  it('preserves known columns from legacy preferences and filters from tag chips', async () => {
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
            'tags',
            'files',
            'documentDate',
            'docType',
            'person',
            'period',
            'signatureStatus',
            'signers',
            'draft',
          ],
          visible: ['tags', 'signers', 'files'],
          version: 2,
        },
      }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Przesuń w dół: Tagi' }));
    await waitFor(() =>
      expect(saved).toHaveBeenLastCalledWith({
        value: {
          order: [
            'files',
            'tags',
            'documentDate',
            'docType',
            'person',
            'period',
            'signatureStatus',
            'signers',
            'draft',
          ],
          visible: ['tags', 'signers', 'files'],
          version: 2,
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
          return HttpResponse.json({
            ok: true,
            data: { outcome: 'updated', document, proposal: null },
          });
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
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ustaw stronę' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ustaw stronę' });
    expect(within(dialog).getByText('Nadpiszesz stronę w 2 dokumentach.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Strona' }), 'Jan Kowalski');
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

  it('summarizes partial failures while approving selected drafts', async () => {
    const approve = vi.fn();
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: {
            documents: [
              draftDocument,
              {
                ...draftDocument,
                id: '66666666-6666-4666-8666-666666666666',
                title: 'Drugi szkic',
              },
            ],
          },
        }),
      ),
      http.post('/api/documents/:id/approve', ({ params }) => {
        const id = String(params.id);
        approve(id);
        if (id === draftDocument.id) {
          return HttpResponse.json({
            ok: true,
            data: { document: { ...draftDocument, draft: false } },
          });
        }
        return HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'Błąd zatwierdzania' } },
          { status: 500 },
        );
      }),
    );
    await renderPage();

    await screen.findAllByText('Drugi szkic');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zatwierdź (2)' }));

    expect(await screen.findByText('Zatwierdzono 1, błędów 1.')).toBeInTheDocument();
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('summarizes partial failures while reverting selected approved documents', async () => {
    const unapprove = vi.fn();
    const secondApproved = {
      ...document,
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Drugi zatwierdzony',
    };
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, secondApproved] },
        }),
      ),
      http.post('/api/documents/:id/unapprove', ({ params }) => {
        const id = String(params.id);
        unapprove(id);
        if (id === document.id) {
          return HttpResponse.json({
            ok: true,
            data: { document: { ...document, draft: true } },
          });
        }
        return HttpResponse.json(
          { ok: false, error: { code: 'internal', message: 'Błąd cofania do szkicu' } },
          { status: 500 },
        );
      }),
    );
    await renderPage();

    await screen.findAllByText('Drugi zatwierdzony');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zaznacz wszystkie dokumenty' }));
    await openBulkMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cofnij do szkicu (2)' }));

    expect(await screen.findByText('Cofnięto do szkicu 1, błędów 1.')).toBeInTheDocument();
    expect(unapprove).toHaveBeenCalledTimes(2);
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

  it('saves teczki presets', async () => {
    const user = userEvent.setup();
    const savedCreate = vi.fn();
    let savedSearches: Array<typeof savedSearch> = [];
    server.use(
      http.get('/api/documents', () =>
        HttpResponse.json({
          ok: true,
          data: { documents: [document, protocolDocument] },
        }),
      ),
      http.get('/api/saved-searches', () =>
        HttpResponse.json({ ok: true, data: { savedSearches } }),
      ),
      http.post('/api/saved-searches', async ({ request }) => {
        const body = await request.json();
        savedCreate(body);
        savedSearches = [savedSearch];
        return HttpResponse.json({ ok: true, data: { savedSearch } });
      }),
    );
    await renderPage();

    await screen.findAllByText('Umowa z Anną');
    expect(screen.getByLabelText('Tag')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag' }), {
      target: { value: 'odbiór' },
    });
    await user.click(screen.getByLabelText('Status podpisu'));
    await user.click(await screen.findByRole('option', { name: 'Podpisane' }));
    await user.click(screen.getByLabelText('Szkice'));
    await user.click(await screen.findByRole('option', { name: 'Wszystkie' }));
    await user.click(screen.getByLabelText('Podpisał(a)'));
    await user.click(await screen.findByRole('option', { name: 'Owner' }));
    await user.click(screen.getByRole('button', { name: 'Zapisz teczkę' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zapisz teczkę' });
    expect(
      within(dialog).getByText('Tag: odbiór · Status podpisu: Podpisane · Podpisał(a): user-owner · Szkice: razem z zatwierdzonymi'),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Nazwa'), {
      target: { value: 'Odbiór' },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz teczkę' }));

    await waitFor(() =>
      expect(savedCreate).toHaveBeenCalledWith({
        name: 'Odbiór',
        filter: {
          tag: 'odbiór',
          signatureStatus: 'signed',
          signerAccountId: 'user-owner',
          draft: 'all',
        },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Zapisz teczkę' })).not.toBeInTheDocument(),
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
    await renderPage('/app/kosz');

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
    await renderPage('/app/kosz');

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
    await renderPage('/app/kosz');

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
    await renderPage('/app/kosz');

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
    await renderPage('/app/kosz');

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
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Strona' }), {
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
