import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentSigningPage } from './DocumentSigningPage.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

const pdfMocks = vi.hoisted(() => ({
  flatten: vi.fn(async () => {
    const bytes = new Uint8Array(2048).fill(7);
    bytes.set([37, 80, 68, 70]);
    return bytes;
  }),
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
  sourcePageMetrics: vi.fn(async () => ({
    cssWidth: 200,
    cssHeight: 300,
    backingWidth: 400,
    backingHeight: 600,
    devicePixelRatio: 2,
    viewportTransform: [1, 0, 0, -1, 0, 300] as const,
  })),
  flattenSignedPdf: pdfMocks.flatten,
}));

const sourceFile = {
  id: SOURCE_ID,
  documentId: DOCUMENT_ID,
  role: 'source',
  fileName: 'oryginal.pdf',
  contentType: 'application/pdf',
  sizeBytes: 512,
  storageKey: 'source-key',
  createdAt: '2026-08-01T10:00:00.000Z',
};

const document = {
  id: DOCUMENT_ID,
  tenantId: 'tenant-1',
  title: 'Umowa do podpisu',
  docType: 'umowa-uod',
  documentDate: '2026-08-01',
  person: 'Anna Nowak',
  tags: [],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  files: [sourceFile],
};

const renderPage = async () => {
  const root = createRootRoute();
  const signing = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id/sign/$fileId',
    component: () => (
      <DocumentSigningPage documentId={DOCUMENT_ID} fileId={SOURCE_ID} />
    ),
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/app/documents/$id',
    component: () => <p>Szczegóły dokumentu</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([signing, detail]),
    history: createMemoryHistory({
      initialEntries: [
        `/app/documents/${DOCUMENT_ID}/sign/${SOURCE_ID}`,
      ],
    }),
  });
  await router.load();
  return renderWithProviders(<RouterProvider router={router} />);
};

const installReadHandlers = () => {
  server.use(
    http.get(`/api/documents/${DOCUMENT_ID}`, () =>
      HttpResponse.json({ ok: true, data: { document } }),
    ),
    http.get(
      `/api/documents/${DOCUMENT_ID}/files/${SOURCE_ID}/content`,
      () =>
        new HttpResponse(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf' },
        }),
    ),
  );
};

const installUploadHandlers = () => {
  server.use(
    http.post(
      `/api/documents/${DOCUMENT_ID}/files/upload-request`,
      () =>
        HttpResponse.json({
          ok: true,
          data: {
            upload: {
              kind: 'server',
              key: 'signed-key',
            },
          },
        }),
    ),
    http.post(`/api/documents/${DOCUMENT_ID}/files/upload`, () =>
      HttpResponse.json({
        ok: true,
        data: {
          file: {
            ...sourceFile,
            id: '44444444-4444-4444-8444-444444444444',
            role: 'signed-digital',
            fileName: 'oryginal-podpisany.pdf',
            sizeBytes: 2048,
            storageKey: 'signed-key',
          },
        },
      }),
    ),
  );
};

beforeEach(() => {
  pdfMocks.flatten.mockClear();
  pdfMocks.destroy.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 200, 300),
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  installReadHandlers();
});

const drawStroke = async (cancel = false) => {
  const canvas = await screen.findByRole('application', {
    name: 'Powierzchnia do rysowania podpisu',
  });
  await waitFor(() => expect(canvas).toHaveAttribute('width', '400'));
  fireEvent.pointerDown(canvas, {
    pointerId: 8,
    clientX: 20,
    clientY: 30,
    pressure: 0.25,
  });
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(8);
  fireEvent.pointerMove(canvas, {
    pointerId: 8,
    clientX: 80,
    clientY: 90,
    pressure: 0.75,
  });
  const finish = new PointerEvent(cancel ? 'pointercancel' : 'pointerup', {
    pointerId: 8,
    clientX: 80,
    clientY: 90,
    pressure: 0,
    bubbles: true,
  });
  fireEvent(canvas, finish);
};

describe('DocumentSigningPage', () => {
  it('captures pointer strokes and supports undo, pointercancel and clear', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    expect(save).toBeDisabled();

    await drawStroke();
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij kreskę' }));
    expect(save).toBeDisabled();

    await drawStroke(true);
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść' }));
    expect(save).toBeDisabled();
  });

  it('flattens and finalizes a new signed-digital PDF through direct upload', async () => {
    let uploaded:
      | { byteLength: number; contentType: string | null }
      | undefined;
    let finalized: unknown;
    server.use(
      http.post(
        `/api/documents/${DOCUMENT_ID}/files/upload-request`,
        () =>
          HttpResponse.json({
            ok: true,
            data: {
              upload: {
                kind: 'direct',
                key: 'signed-key',
                target: {
                  url: 'http://localhost/direct-signature',
                  method: 'PUT',
                  headers: {
                    'content-type': 'application/pdf',
                    'x-upload': 'signature',
                  },
                },
              },
            },
          }),
      ),
      http.put(
        'http://localhost/direct-signature',
        async ({ request }) => {
          uploaded = {
            byteLength: (await request.arrayBuffer()).byteLength,
            contentType: request.headers.get('content-type'),
          };
          return new HttpResponse(null, { status: 200 });
        },
      ),
      http.post(
        `/api/documents/${DOCUMENT_ID}/files/finalize`,
        async ({ request }) => {
          finalized = await request.json();
          return HttpResponse.json({
            ok: true,
            data: {
              file: {
                ...sourceFile,
                id: '33333333-3333-4333-8333-333333333333',
                role: 'signed-digital',
                fileName: 'oryginal-podpisany.pdf',
                sizeBytes: 2048,
                storageKey: 'signed-key',
              },
            },
          });
        },
      ),
    );
    await renderPage();
    await drawStroke();

    await userEvent.click(screen.getByRole('button', { name: 'Granatowy' }));
    const save = screen.getByRole('button', { name: 'Zapisz podpisany PDF' });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await waitFor(() => expect(uploaded).toBeDefined());
    expect(pdfMocks.flatten).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      [
        expect.objectContaining({
          stamp: expect.objectContaining({
            pageIndex: 0,
            inkColor: expect.objectContaining({
              id: 'navy',
              canvasColor: '#1c2a5e',
            }),
          }),
          metrics: expect.objectContaining({
            cssWidth: 200,
            cssHeight: 300,
          }),
        }),
      ],
    );
    expect(uploaded).toEqual({
      byteLength: 2048,
      contentType: 'application/pdf',
    });
    expect(finalized).toEqual({
      key: 'signed-key',
      fileName: 'oryginal-podpisany.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      role: 'signed-digital',
    });
  });

  it('adds and removes a placed stamp on the current page', async () => {
    await renderPage();
    await drawStroke();

    await userEvent.click(
      screen.getByRole('button', { name: 'Przybij na tej stronie' }),
    );
    expect(screen.getByText('Wybrany odcisk: strona 1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Usuń' }));

    expect(screen.getByText('Położenie bieżącego rysunku')).toBeInTheDocument();
  });

  it('stamps the draft on every page before flattening', async () => {
    installUploadHandlers();
    await renderPage();
    await drawStroke();

    await userEvent.click(
      screen.getByRole('button', { name: 'Przybij na każdej stronie' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zapisz podpisany PDF' }));

    await waitFor(() =>
      expect(pdfMocks.flatten).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        [
          expect.objectContaining({
            stamp: expect.objectContaining({ pageIndex: 0 }),
          }),
          expect.objectContaining({
            stamp: expect.objectContaining({ pageIndex: 1 }),
          }),
        ],
      ),
    );
  });
});
