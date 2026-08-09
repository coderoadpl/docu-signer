import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render.js';
import { server } from '../../test/server.js';
import { DocumentSigningPage } from './DocumentSigningPage.js';
import type { SigningStampWithMetrics } from './signing-pdf.js';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

const pdfMocks = vi.hoisted(() => ({
  flatten: vi.fn<
    (
      sourceBytes: Uint8Array,
      stamps: readonly SigningStampWithMetrics[],
    ) => Promise<Uint8Array>
  >(async () => {
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
  periodStart: null,
  periodEnd: null,
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
  await waitFor(() => {
    expect(canvas).toHaveAttribute('aria-busy', 'false');
    expect(canvas).toHaveAttribute('width', '400');
    expect(screen.queryByLabelText('Renderowanie strony PDF')).not.toBeInTheDocument();
  });
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

const signaturePadCanvas = async () =>
  screen.findByRole('application', {
    name: 'Powierzchnia do złożenia podpisu',
  });

const drawSignaturePadStroke = async (options: {
  height?: number;
  pointerId: number;
  pointerType: string;
  width?: number;
}) => {
  const canvas = await signaturePadCanvas();
  fireEvent.pointerDown(canvas, {
    pointerId: options.pointerId,
    pointerType: options.pointerType,
    clientX: 20,
    clientY: 30,
    pressure: 0.35,
    width: options.width,
    height: options.height,
  });
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(options.pointerId);
  fireEvent.pointerMove(canvas, {
    pointerId: options.pointerId,
    pointerType: options.pointerType,
    clientX: 80,
    clientY: 90,
    pressure: 0.85,
    width: options.width,
    height: options.height,
  });
  fireEvent(
    canvas,
    new PointerEvent('pointerup', {
      pointerId: options.pointerId,
      pointerType: options.pointerType,
      bubbles: true,
    }),
  );
};

const pointerEventWithCoalesced = (
  type: string,
  init: PointerEventInit,
  coalesced: ReadonlyArray<{
    clientX: number;
    clientY: number;
    pressure: number;
  }>,
) => {
  const event = new PointerEvent(type, { ...init, bubbles: true });
  Object.defineProperty(event, 'getCoalescedEvents', {
    configurable: true,
    value: () => coalesced,
  });
  return event;
};

const pointerEventAt = (
  type: string,
  init: PointerEventInit,
  timeStamp: number,
) => {
  const event = new PointerEvent(type, { ...init, bubbles: true });
  Object.defineProperty(event, 'timeStamp', {
    configurable: true,
    value: timeStamp,
  });
  return event;
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

  it('keeps touch from inking by default in draw mode while pen inks', async () => {
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

  it('keeps Przesuń from inking and lets Rysuj ink with pen', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    const canvas = await signingCanvas();

    fireEvent.click(screen.getByRole('button', { name: 'Przesuń' }));
    fireEvent.pointerDown(canvas, {
      pointerId: 21,
      pointerType: 'pen',
      clientX: 20,
      clientY: 30,
      pressure: 0.4,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      pointerType: 'pen',
      clientX: 80,
      clientY: 90,
      pressure: 0.7,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 21,
        pointerType: 'pen',
        bubbles: true,
      }),
    );

    expect(canvas.setPointerCapture).not.toHaveBeenCalledWith(21);
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Rysuj' }));
    await drawStroke({ pointerId: 22, pointerType: 'pen' });
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('keeps the current gesture mode when a selected toggle emits no next value', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    const canvas = await signingCanvas();

    fireEvent.click(screen.getByRole('button', { name: 'Rysuj' }));
    fireEvent.pointerDown(canvas, {
      pointerId: 27,
      pointerType: 'pen',
      clientX: 20,
      clientY: 30,
      pressure: 0.4,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 27,
        pointerType: 'pen',
        bubbles: true,
      }),
    );

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

  it('draws large touch contacts when finger drawing is enabled', async () => {
    await renderPage();
    const save = await screen.findByRole('button', {
      name: 'Zapisz podpisany PDF',
    });
    const canvas = await signingCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Rysowanie palcem' }));

    fireEvent.pointerDown(canvas, {
      pointerId: 23,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30,
      pressure: 0.5,
      width: 60,
      height: 44,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 23,
      pointerType: 'touch',
      clientX: 80,
      clientY: 90,
      pressure: 0.5,
      width: 60,
      height: 44,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 23,
        pointerType: 'touch',
        bubbles: true,
      }),
    );

    expect(canvas.setPointerCapture).toHaveBeenCalledWith(23);
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('cancels touch ink while a pen pointer is active', async () => {
    installUploadHandlers();
    await renderPage();
    const canvas = await signingCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Rysowanie palcem' }));

    fireEvent.pointerDown(canvas, {
      pointerId: 24,
      pointerType: 'touch',
      clientX: 20,
      clientY: 30,
      pressure: 0.5,
      width: 12,
      height: 12,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 24,
      pointerType: 'touch',
      clientX: 50,
      clientY: 60,
      pressure: 0.5,
      width: 12,
      height: 12,
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 25,
      pointerType: 'pen',
      clientX: 80,
      clientY: 90,
      pressure: 0.5,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 25,
      pointerType: 'pen',
      clientX: 120,
      clientY: 130,
      pressure: 0.8,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 25,
        pointerType: 'pen',
        bubbles: true,
      }),
    );
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 24,
        pointerType: 'touch',
        bubbles: true,
      }),
    );

    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));
    await waitFor(() => expect(pdfMocks.flatten).toHaveBeenCalled());
    expect(pdfMocks.flatten.mock.calls[0]?.[1]?.[0]?.stamp.strokes).toHaveLength(1);
  });

  it('suppresses large touch contacts during the pen-priority window', async () => {
    await renderPage();
    const canvas = await signingCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Rysowanie palcem' }));

    fireEvent(
      canvas,
      pointerEventAt(
        'pointerdown',
        {
          pointerId: 53,
          pointerType: 'pen',
          clientX: 20,
          clientY: 30,
          pressure: 0.5,
        },
        100,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerup',
        {
          pointerId: 53,
          pointerType: 'pen',
          clientX: 20,
          clientY: 30,
          pressure: 0,
        },
        100,
      ),
    );
    fireEvent.click(await enabledButton('Wyczyść'));
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerdown',
        {
          pointerId: 54,
          pointerType: 'touch',
          clientX: 30,
          clientY: 40,
          pressure: 0.5,
          width: 60,
          height: 44,
        },
        600,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointermove',
        {
          pointerId: 54,
          pointerType: 'touch',
          clientX: 80,
          clientY: 90,
          pressure: 0.5,
          width: 60,
          height: 44,
        },
        620,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerup',
        {
          pointerId: 54,
          pointerType: 'touch',
          clientX: 80,
          clientY: 90,
          pressure: 0,
          width: 60,
          height: 44,
        },
        630,
      ),
    );

    expect(canvas.setPointerCapture).not.toHaveBeenCalledWith(54);
    expect(screen.getByRole('button', { name: 'Zapisz podpisany PDF' })).toBeDisabled();
  });

  it('allows finger ink after the pen-priority window expires', async () => {
    await renderPage();
    const canvas = await signingCanvas();
    fireEvent.click(screen.getByRole('button', { name: 'Rysowanie palcem' }));

    fireEvent(
      canvas,
      pointerEventAt(
        'pointerdown',
        {
          pointerId: 51,
          pointerType: 'pen',
          clientX: 20,
          clientY: 30,
          pressure: 0.5,
        },
        100,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerup',
        {
          pointerId: 51,
          pointerType: 'pen',
          clientX: 20,
          clientY: 30,
          pressure: 0,
        },
        100,
      ),
    );
    fireEvent.click(await enabledButton('Wyczyść'));
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerdown',
        {
          pointerId: 52,
          pointerType: 'touch',
          clientX: 30,
          clientY: 40,
          pressure: 0.5,
          width: 12,
          height: 12,
        },
        601,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointermove',
        {
          pointerId: 52,
          pointerType: 'touch',
          clientX: 80,
          clientY: 90,
          pressure: 0.5,
          width: 12,
          height: 12,
        },
        650,
      ),
    );
    fireEvent(
      canvas,
      pointerEventAt(
        'pointerup',
        {
          pointerId: 52,
          pointerType: 'touch',
          clientX: 80,
          clientY: 90,
          pressure: 0,
          width: 12,
          height: 12,
        },
        660,
      ),
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Zapisz podpisany PDF' })).toBeEnabled(),
    );
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(52);
  });

  it('uses coalesced pointer samples for document ink', async () => {
    installUploadHandlers();
    await renderPage();
    const canvas = await signingCanvas();

    fireEvent.pointerDown(canvas, {
      pointerId: 26,
      pointerType: 'pen',
      clientX: 20,
      clientY: 30,
      pressure: 0.25,
    });
    fireEvent(
      canvas,
      pointerEventWithCoalesced(
        'pointermove',
        {
          pointerId: 26,
          pointerType: 'pen',
          clientX: 80,
          clientY: 90,
          pressure: 0.75,
        },
        [
          { clientX: 40, clientY: 50, pressure: 0.35 },
          { clientX: 60, clientY: 70, pressure: 0.55 },
          { clientX: 80, clientY: 90, pressure: 0.75 },
        ],
      ),
    );
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 26,
        pointerType: 'pen',
        bubbles: true,
      }),
    );

    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));
    await waitFor(() => expect(pdfMocks.flatten).toHaveBeenCalled());
    expect(
      pdfMocks.flatten.mock.calls[0]?.[1]?.[0]?.stamp.strokes[0]?.points,
    ).toHaveLength(4);
  });

  it('uses the pointer event as the document ink sample when coalescing is unavailable', async () => {
    installUploadHandlers();
    await renderPage();
    const canvas = await signingCanvas();

    fireEvent.pointerDown(canvas, {
      pointerId: 28,
      pointerType: 'pen',
      clientX: 20,
      clientY: 30,
      pressure: 0.25,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 28,
      pointerType: 'pen',
      clientX: 80,
      clientY: 90,
      pressure: 0.75,
    });
    fireEvent(
      canvas,
      new PointerEvent('pointerup', {
        pointerId: 28,
        pointerType: 'pen',
        bubbles: true,
      }),
    );

    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));
    await waitFor(() => expect(pdfMocks.flatten).toHaveBeenCalled());
    expect(
      pdfMocks.flatten.mock.calls[0]?.[1]?.[0]?.stamp.strokes[0]?.points,
    ).toHaveLength(2);
  });

  it('opens the signature pad and places its ink as a stamp on the current page', async () => {
    installUploadHandlers();
    await renderPage();
    await signingCanvas();

    const nextPage = screen.getByRole('button', { name: /Następna/u });
    await waitFor(() => expect(nextPage).toBeEnabled());
    fireEvent.click(nextPage);
    await waitFor(() => expect(screen.getByText('Strona 2 z 2')).toBeInTheDocument());
    await signingCanvas();
    fireEvent.click(await enabledButton('Złóż podpis'));
    expect(
      await screen.findByRole('dialog', { name: 'Złóż podpis' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Użyj podpisu' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Granatowy' }));
    await drawSignaturePadStroke({
      pointerId: 31,
      pointerType: 'touch',
      width: 60,
      height: 44,
    });
    await drawSignaturePadStroke({ pointerId: 32, pointerType: 'pen' });
    fireEvent.click(screen.getByRole('button', { name: 'Użyj podpisu' }));

    expect(
      await screen.findByText('Wybrany odcisk: strona 2'),
    ).toBeInTheDocument();
    fireEvent.click(await enabledButton('Zapisz podpisany PDF'));
    await waitFor(() =>
      expect(pdfMocks.flatten).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        [
          expect.objectContaining({
            stamp: expect.objectContaining({
              pageIndex: 1,
              inkColor: expect.objectContaining({ id: 'navy' }),
              strokes: expect.arrayContaining([
                expect.objectContaining({ points: expect.any(Array) }),
              ]),
            }),
          }),
        ],
      ),
    );
  });

  it('cancels the signature pad without placing a stamp', async () => {
    await renderPage();
    await signingCanvas();

    fireEvent.click(await enabledButton('Złóż podpis'));
    const dialog = await screen.findByRole('dialog', { name: 'Złóż podpis' });
    await drawSignaturePadStroke({ pointerId: 33, pointerType: 'pen' });
    expect(within(dialog).getByRole('button', { name: 'Użyj podpisu' })).toBeEnabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Złóż podpis' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Odciski w sesji: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zapisz podpisany PDF' })).toBeDisabled();
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

  it('drags an existing stamp with touch in pan mode', async () => {
    installUploadHandlers();
    await renderPage();
    await drawStroke();

    fireEvent.click(await enabledButton('Przybij na tej stronie'));
    expect(
      await screen.findByText('Wybrany odcisk: strona 1'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Przesuń' }));

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
