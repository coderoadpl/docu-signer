import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentReviewPage } from './DocumentReviewPage.js';
import {
  documentReviewSearchSchema,
  documentsSearchSchema,
} from './documents.logic.js';
import { renderSourcePage } from './signing-pdf.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const NEXT_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SIGNED_ID = '44444444-4444-4444-8444-444444444444';
const SCAN_ID = '55555555-5555-4555-8555-555555555555';

const pdfMocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
}));

vi.mock('./signing-pdf.js', () => ({
  loadSourcePdf: vi.fn(async () => ({
    document: {},
    numPages: 2,
    destroy: pdfMocks.destroy,
  })),
  renderSourcePage: vi.fn(async (_pdf, _pageNumber, canvas: HTMLCanvasElement) => {
    canvas.width = 400;
    canvas.height = 600;
    return {
      cssWidth: 200,
      cssHeight: 300,
      backingWidth: 400,
      backingHeight: 600,
      devicePixelRatio: 2,
      viewportTransform: [1, 0, 0, -1, 0, 300] as const,
    };
  }),
}));

const sourceFile = {
  id: SOURCE_ID,
  documentId: DOCUMENT_ID,
  role: 'source' as const,
  fileName: 'umowa.pdf',
  contentType: 'application/pdf',
  sizeBytes: 4,
  storageKey: 'source-key',
  createdAt: '2026-08-01T10:00:00.000Z',
};

const scanFile = {
  ...sourceFile,
  id: SCAN_ID,
  role: 'signed-scan' as const,
  fileName: 'umowa-skan.pdf',
  createdAt: '2026-08-02T10:00:00.000Z',
};

const document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa do przeglądu',
  docType: 'umowa-uod' as const,
  documentDate: '2026-08-01',
  periodStart: null,
  periodEnd: null,
  person: 'Anna Nowak',
  tags: ['ważne'],
  draft: false,
  deletedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  signers: [],
  files: [sourceFile],
};

const nextDocument = {
  ...document,
  id: NEXT_DOCUMENT_ID,
  title: 'Rachunek do przeglądu',
  docType: 'rachunek' as const,
  files: [],
};

const signedDocument = {
  ...document,
  files: [
    sourceFile,
    scanFile,
    {
      ...sourceFile,
      id: SIGNED_ID,
      role: 'signed-digital' as const,
      fileName: 'umowa-podpisana.pdf',
      createdAt: '2026-08-03T10:00:00.000Z',
    },
  ],
};

const renderPage = async (initialEntry: string) => {
  const root = createRootRoute();
  const ReviewRouteComponent = () => {
    const params = useParams({ from: '/app/documents/$id/review' });
    return <DocumentReviewPage documentId={params.id} />;
  };
  const review = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id/review',
    validateSearch: documentReviewSearchSchema,
    component: ReviewRouteComponent,
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/app/documents',
    validateSearch: documentsSearchSchema,
    component: () => <p>Lista dokumentów</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([review, list]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
};

beforeEach(() => {
  pdfMocks.destroy.mockClear();
  vi.mocked(renderSourcePage).mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 300),
  );
  server.use(
    http.get('/api/documents', () =>
      HttpResponse.json({
        ok: true,
        data: { documents: [document, nextDocument] },
      }),
    ),
    http.get('/api/documents/:documentId', ({ params }) =>
      HttpResponse.json({
        ok: true,
        data: {
          document:
            params.documentId === NEXT_DOCUMENT_ID ? nextDocument : document,
        },
      }),
    ),
    http.get(`/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`, () =>
      new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
        headers: { 'content-type': 'application/pdf' },
      }),
    ),
  );
});

describe('DocumentReviewPage', () => {
  it('disables signed mode when the document has no signed-digital file', async () => {
    await renderPage(`/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID}`);

    const signedMode = await screen.findByRole('button', { name: 'Podpisany' });
    expect(signedMode).toBeDisabled();
    await userEvent.hover(signedMode.parentElement ?? signedMode);
    expect(
      await screen.findByText('Ten dokument nie ma podpisanego pliku cyfrowego'),
    ).toBeVisible();
  });

  it('opens a scan-only document on the scan without a missing-file message', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, files: [scanFile] } },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SCAN_ID}/content`, () =>
        new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );

    await renderPage(`/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID}`);

    expect(
      await screen.findByRole('button', { name: 'Skan', pressed: true }),
    ).toBeVisible();
    expect(screen.queryByText('Brak pliku źródłowego')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Ten dokument nie ma podpisanego pliku cyfrowego'),
    ).not.toBeInTheDocument();
  });

  it('saves metadata from edit mode and returns to source mode', async () => {
    const update = vi.fn();
    server.use(
      http.patch(`/api/documents/${DOCUMENT_ID}`, async ({ request }) => {
        const input = await request.json();
        update(input);
        return HttpResponse.json({
          ok: true,
          data: { document: { ...document, title: 'Zmieniony tytuł' } },
        });
      }),
    );
    const { router } = await renderPage(
      `/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID}&tryb=edycja`,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Tytuł' }), {
      target: { value: 'Zmieniony tytuł' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Zmieniony tytuł' }),
      ),
    );
    await waitFor(() => expect(router.state.location.search.tryb).toBeUndefined());
    expect(screen.getByRole('button', { name: 'Źródło', pressed: true })).toBeVisible();
  });

  it('asks for inline confirmation before leaving unsaved edits', async () => {
    const { router } = await renderPage(
      `/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID},${NEXT_DOCUMENT_ID}&tryb=edycja`,
    );

    fireEvent.change(await screen.findByRole('textbox', { name: 'Tytuł' }), {
      target: { value: 'Niezapisany tytuł' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));

    expect(await screen.findByText('Ten dokument ma niezapisane zmiany.')).toBeVisible();
    expect(router.state.location.pathname).toBe(
      `/app/documents/${DOCUMENT_ID}/review`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Wróć' }));
    expect(screen.queryByText('Ten dokument ma niezapisane zmiany.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/documents/${NEXT_DOCUMENT_ID}/review`,
      ),
    );
    expect(router.state.location.search.tryb).toBeUndefined();
  });

  it('opens the newest signed PDF ahead of the scan and source, changes pages and closes', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: signedDocument } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SIGNED_ID}/content`, () =>
        new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SCAN_ID}/content`, () =>
        new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );
    const { router } = await renderPage(
      `/app/documents/${DOCUMENT_ID}/review?q=umowa&kolejka=${DOCUMENT_ID}`,
    );

    expect(await screen.findByRole('button', { name: 'Podpisany', pressed: true })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Skan' }));
    await waitFor(() => expect(router.state.location.search.tryb).toBe('skan'));
    expect(await screen.findByRole('button', { name: 'Skan', pressed: true })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Źródło' }));
    await waitFor(() => expect(router.state.location.search.tryb).toBe('zrodlo'));
    expect(await screen.findByRole('button', { name: 'Źródło', pressed: true })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Podpisany' }));
    expect(await screen.findByRole('button', { name: 'Podpisany', pressed: true })).toBeVisible();
    expect(await screen.findByText('str. 1 z 2')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Następna strona' }));
    expect(await screen.findByText('str. 2 z 2')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednia strona' }));
    expect(await screen.findByText('str. 1 z 2')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/documents'));
    expect(router.state.location.search).toMatchObject({ q: 'umowa' });
  });

  it('moves backward and forward through documents without source files', async () => {
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({ ok: true, data: { document: signedDocument } }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SIGNED_ID}/content`, () =>
        new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );
    const { router } = await renderPage(
      `/app/documents/${DOCUMENT_ID}/review?kolejka=${NEXT_DOCUMENT_ID},${DOCUMENT_ID}&tryb=podpisany`,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Wstecz' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/documents/${NEXT_DOCUMENT_ID}/review`,
      ),
    );
    expect(router.state.location.search.tryb).toBeUndefined();
    expect(await screen.findByText('Brak pliku źródłowego')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Dalej' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/app/documents/${DOCUMENT_ID}/review`,
      ),
    );
    expect(await screen.findByRole('button', { name: 'Podpisany', pressed: true })).toBeVisible();
    expect(screen.getByText('Dokument 2 z 2')).toBeVisible();
  });

  it('remeasures after PDF data loads while the loading indicator stays out of flow', async () => {
    let releaseFile: (() => void) | undefined;
    const fileGate = new Promise<void>((resolve) => {
      releaseFile = resolve;
    });
    const elementBounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 800, 600));
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`, async () => {
        await fileGate;
        return new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        });
      }),
    );

    try {
      const { unmount } = await renderPage(
        `/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID}`,
      );
      const progress = await screen.findByRole('progressbar', {
        name: 'Ładowanie podglądu pliku',
      });
      expect(progress.parentElement).toHaveStyle({ position: 'absolute' });
      const measurementsBeforeLoad = elementBounds.mock.calls.length;

      releaseFile?.();
      await waitFor(() => expect(elementBounds.mock.calls.length).toBeGreaterThan(measurementsBeforeLoad));
      await waitFor(() =>
        expect(vi.mocked(renderSourcePage)).toHaveBeenCalledWith(
          expect.anything(),
          1,
          expect.any(HTMLCanvasElement),
          { width: 800, height: 600 },
        ),
      );
      unmount();
    } finally {
      releaseFile?.();
      elementBounds.mockRestore();
    }
  });

  it('returns to the list when the current document is absent from the queue', async () => {
    const { router } = await renderPage(
      `/app/documents/${DOCUMENT_ID}/review?q=brak&kolejka=${NEXT_DOCUMENT_ID}`,
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/documents'));
    expect(router.state.location.search).toMatchObject({ q: 'brak' });
  });

  it('fits an image source in the review surface', async () => {
    const imageFile = {
      ...sourceFile,
      fileName: 'skan.jpg',
      contentType: 'image/jpeg',
    };
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:review-image'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    server.use(
      http.get(`/api/documents/${DOCUMENT_ID}`, () =>
        HttpResponse.json({
          ok: true,
          data: { document: { ...document, files: [imageFile] } },
        }),
      ),
      http.get(`/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`, () =>
        new HttpResponse(new Uint8Array([255, 216, 255]), {
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );

    await renderPage(`/app/documents/${DOCUMENT_ID}/review?kolejka=${DOCUMENT_ID}`);

    expect(await screen.findByRole('img', { name: 'skan.jpg' })).toHaveAttribute(
      'src',
      'blob:review-image',
    );
  });
});
