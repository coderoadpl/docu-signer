import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

const enabledButton = async (name: string) => {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

class RecordingCanvasContext {
  strokeStyle = '';
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  lineWidth = 1;
  readonly strokeStyles: string[] = [];
  readonly clearRect = vi.fn();
  readonly beginPath = vi.fn();
  readonly moveTo = vi.fn();
  readonly quadraticCurveTo = vi.fn();
  readonly stroke = vi.fn(() => {
    this.strokeStyles.push(this.strokeStyle);
  });
  readonly save = vi.fn();
  readonly restore = vi.fn();
  readonly setLineDash = vi.fn();
  readonly strokeRect = vi.fn();
}

const installRecordingCanvasContext = () => {
  const context = new RecordingCanvasContext();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => context,
  });
  return context;
};

const signingCanvas = async () => {
  const canvas = await screen.findByRole('application', {
    name: 'Powierzchnia do rysowania podpisu',
  });
  await waitFor(() => expect(canvas).toHaveAttribute('aria-busy', 'false'));
  return canvas;
};

const drawStroke = async (options: {
  cancel?: boolean;
  pointerId?: number;
  pointerType?: string;
} = {}) => {
  const canvas = await signingCanvas();
  const pointerId = options.pointerId ?? 8;
  const pointerType = options.pointerType ?? 'pen';
  fireEvent.pointerDown(canvas, {
    pointerId,
    pointerType,
    clientX: 20,
    clientY: 30,
    pressure: 0.25,
  });
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(pointerId);
  fireEvent.pointerMove(canvas, {
    pointerId,
    pointerType,
    clientX: 80,
    clientY: 90,
    pressure: 0.75,
  });
  const finish = new PointerEvent(options.cancel ? 'pointercancel' : 'pointerup', {
    pointerId,
    pointerType,
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
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij kreskę' }));
    expect(save).toBeDisabled();

    await drawStroke({ cancel: true });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść' }));
    expect(save).toBeDisabled();
  });

  it('lets pen draw while touch scrolls by default', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    const canvas = await signingCanvas();

    fireEvent.pointerDown(canvas, {
      pointerId: 11,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30,
      pressure: 0.5,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 11,
      pointerType: 'touch',
      clientX: 80,
      clientY: 90,
      pressure: 0.5,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 11,
        pointerType: 'touch',
        bubbles: true,
      }),
    );

    expect(canvas.setPointerCapture).not.toHaveBeenCalledWith(11);
    expect(save).toBeDisabled();

    await drawStroke({ pointerId: 12, pointerType: 'pen' });
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('draws touch strokes when finger drawing is enabled', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Rysowanie palcem' }));
    await drawStroke({ pointerId: 13, pointerType: 'touch' });

    await waitFor(() => expect(save).toBeEnabled());
  });

  it('uses the selected navy ink for live canvas strokes', async () => {
    const context = installRecordingCanvasContext();
    await renderPage();

    await signingCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Granatowy' }));
    await drawStroke();

    await waitFor(() => expect(context.strokeStyles).toContain('#2244aa'));
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

    fireEvent.click(screen.getByRole('button', { name: 'Granatowy' }));
    const save = screen.getByRole('button', { name: 'Zapisz podpisany PDF' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(uploaded).toBeDefined());
    expect(pdfMocks.flatten).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      [
        expect.objectContaining({
          stamp: expect.objectContaining({
            pageIndex: 0,
            inkColor: expect.objectContaining({
              id: 'navy',
              canvasColor: '#2244aa',
              pdfColor: { red: 0.13, green: 0.27, blue: 0.67 },
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

    fireEvent.click(await enabledButton('Przybij na tej stronie'));
    expect(
      await screen.findByText('Wybrany odcisk: strona 1'),
    ).toBeInTheDocument();

    fireEvent.click(await enabledButton('Usuń'));

    expect(screen.getByText('Położenie bieżącego rysunku')).toBeInTheDocument();
  });

  it('drags an existing stamp with touch in placement mode', async () => {
    installUploadHandlers();
    await renderPage();
    await drawStroke();

    fireEvent.click(await enabledButton('Przybij na tej stronie'));
    expect(
      await screen.findByText('Wybrany odcisk: strona 1'),
    ).toBeInTheDocument();

    const canvas = await signingCanvas();
    fireEvent.pointerDown(canvas, {
      pointerId: 14,
      pointerType: 'touch',
      clientX: 50,
      clientY: 60,
      pressure: 0.5,
    });
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(14);
    fireEvent.pointerMove(canvas, {
      pointerId: 14,
      pointerType: 'touch',
      clientX: 70,
      clientY: 90,
      pressure: 0.5,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 14,
        pointerType: 'touch',
        bubbles: true,
      }),
    );

    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));
    await waitFor(() =>
      expect(pdfMocks.flatten).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        [
          expect.objectContaining({
            stamp: expect.objectContaining({
              placement: expect.objectContaining({
                offsetX: 0.1,
                offsetY: 0.1,
              }),
            }),
          }),
        ],
      ),
    );
  });

  it('stamps the draft on every page before flattening', async () => {
    installUploadHandlers();
    await renderPage();
    await drawStroke();

    fireEvent.click(await enabledButton('Przybij na każdej stronie'));
    expect(
      await screen.findByText('Wybrany odcisk: strona 1'),
    ).toBeInTheDocument();
    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));

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
