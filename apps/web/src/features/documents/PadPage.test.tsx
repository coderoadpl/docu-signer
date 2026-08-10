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
import { PadQrDialog } from './DocumentSigningPage.js';
import { PadPage } from './PadPage.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const pointerCapture = vi.fn();

const me = {
  userId: 'user-owner',
  email: 'owner@example.com',
  name: 'Owner',
  tenant: {
    id: 'tenant-default',
    slug: 'default',
    name: 'Archive',
    staffRole: 'owner',
  },
};

const renderPad = () => {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/pad/$sessionId',
    component: () => <PadPage sessionId={SESSION_ID} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [`/pad/${SESSION_ID}`],
    }),
  });
  return renderWithProviders(<RouterProvider router={router} />);
};

const useActiveRequest = () => {
  server.use(
    http.get('*/api/pad-sessions/:sessionId/state', () =>
      HttpResponse.json({
        ok: true,
        data: {
          status: 'active',
          currentRequest: {
            requestId: REQUEST_ID,
            documentTitle: 'Umowa do podpisu',
          },
        },
      }),
    ),
  );
};

const drawStroke = (
  canvas: HTMLElement,
  pointerType: 'mouse' | 'pen' | 'touch',
  pointerId: number,
) => {
  fireEvent.pointerDown(canvas, {
    pointerId,
    pointerType,
    clientX: 40,
    clientY: 40,
    pressure: 0.5,
    buttons: 1,
  });
  fireEvent.pointerMove(canvas, {
    pointerId,
    pointerType,
    clientX: 120,
    clientY: 90,
    pressure: 0.5,
    buttons: 1,
  });
  fireEvent.pointerUp(canvas, {
    pointerId,
    pointerType,
    clientX: 120,
    clientY: 90,
    pressure: 0,
    buttons: 0,
  });
};

const tap = (
  target: HTMLElement,
  pointerType: 'mouse' | 'pen' | 'touch',
  pointerId: number,
) => {
  fireEvent.pointerDown(target, { pointerId, pointerType, buttons: 1 });
  fireEvent.pointerUp(target, { pointerId, pointerType, buttons: 0 });
  fireEvent.click(target);
};

describe('PadQrDialog', () => {
  it('renders loading and error states before a QR URL exists', () => {
    const closeSession = vi.fn();
    renderWithProviders(
      <PadQrDialog
        open
        loading
        error="Nie udało się utworzyć sesji pada."
        onClose={vi.fn()}
        onCloseSession={closeSession}
      />,
    );

    expect(screen.getByLabelText('Tworzenie sesji pada')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się utworzyć sesji pada.');
    const closeSessionButton = screen.getByRole('button', { name: 'Zakończ całą sesję' });
    expect(closeSessionButton).toBeDisabled();
    fireEvent.click(closeSessionButton);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('renders the generated QR and supports closing the session', () => {
    const close = vi.fn();
    const closeSession = vi.fn();
    renderWithProviders(
      <PadQrDialog
        open
        loading={false}
        qrDataUrl="data:image/png;base64,abc"
        sessionUrl="http://localhost/pad/1#s=secret"
        onClose={close}
        onCloseSession={closeSession}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Pad QR' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Kod QR pada podpisu' })).toHaveAttribute(
      'src',
      'data:image/png;base64,abc',
    );
    expect(screen.getByText(/Zeskanuj kod/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Zakończ całą sesję' }));
    expect(closeSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Schowaj kod QR' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('PadPage', () => {
  beforeEach(() => {
    pointerCapture.mockClear();
    window.scrollTo = vi.fn();
    window.history.pushState(null, '', `/pad/${SESSION_ID}#s=pad_secret`);
    const canvasContext = {
      fillStyle: '',
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
    };
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => canvasContext,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 320, 240),
    );
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: pointerCapture,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    server.use(
      http.get('*/api/me', () => HttpResponse.json({ ok: true, data: me })),
    );
  });

  it('renders the waiting state after a logged-in pad opens the QR URL', async () => {
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: { status: 'active', currentRequest: null },
        }),
      ),
    );

    renderPad();

    expect(await screen.findAllByRole('heading', { name: 'Czekam na dokument…' })).toHaveLength(2);
    expect(screen.getByText('Ekran obudzi się przy następnym podpisie.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rozłącz' })).toBeVisible();
  });

  it('keeps the waiting view static during a background refetch', async () => {
    let stateRequests = 0;
    let backgroundStarted: (() => void) | undefined;
    let finishBackground: (() => void) | undefined;
    const backgroundStart = new Promise<void>((resolve) => {
      backgroundStarted = resolve;
    });
    const backgroundFinish = new Promise<void>((resolve) => {
      finishBackground = resolve;
    });
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', async () => {
        stateRequests += 1;
        if (stateRequests > 1) {
          backgroundStarted?.();
          await backgroundFinish;
        }
        return HttpResponse.json({
          ok: true,
          data: { status: 'active', currentRequest: null },
        });
      }),
    );

    const { queryClient } = renderPad();

    expect(await screen.findByText('Ekran obudzi się przy następnym podpisie.')).toBeVisible();
    const headingCount = screen.getAllByRole('heading', {
      name: 'Czekam na dokument…',
    }).length;
    const refetch = queryClient.refetchQueries();
    await backgroundStart;

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Czekam na dokument…' })).toHaveLength(
      headingCount,
    );
    finishBackground?.();
    await refetch;
  });

  it('renders the drawing state when the desktop requests a signature', async () => {
    useActiveRequest();

    renderPad();

    expect(await screen.findByRole('heading', { name: 'Umowa do podpisu' })).toBeVisible();
    expect(screen.getByRole('application', { name: 'Powierzchnia pada do podpisu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wyczyść' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Granatowy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Piórko' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps the shared canvas live for proactive signatures', async () => {
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: {
            mode: 'shared',
            status: 'active',
            currentRequest: null,
            currentDocument: {
              key: 'document-a:file-a',
              title: 'Umowa wspólna',
            },
          },
        }),
      ),
    );

    renderPad();

    expect(await screen.findByRole('heading', { name: 'Możesz złożyć podpis' })).toBeVisible();
    expect(screen.getByText('Umowa wspólna')).toBeVisible();
    expect(screen.getByRole('application', { name: 'Powierzchnia pada do podpisu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
  });

  it.each([
    { mode: 'Piórko', pointerType: 'pen' },
    { mode: 'Ręka', pointerType: 'pen' },
    { mode: 'Piórko', pointerType: 'mouse' },
    { mode: 'Ręka', pointerType: 'mouse' },
  ] as const)('accepts a $pointerType stroke in $mode mode', async ({ mode, pointerType }) => {
    useActiveRequest();
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    if (mode === 'Ręka') tap(screen.getByRole('button', { name: 'Ręka' }), 'touch', 40);
    drawStroke(canvas, pointerType, 41);

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
  });

  it('rejects touch strokes without pointer capture in Piórko mode', async () => {
    useActiveRequest();
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    drawStroke(canvas, 'touch', 42);

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
    expect(pointerCapture).not.toHaveBeenCalled();
  });

  it('accepts touch strokes in Ręka mode', async () => {
    useActiveRequest();
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    tap(screen.getByRole('button', { name: 'Ręka' }), 'touch', 43);
    drawStroke(canvas, 'touch', 44);

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
  });

  it('rejects touch in Ręka mode while pen priority is active', async () => {
    useActiveRequest();
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    tap(screen.getByRole('button', { name: 'Ręka' }), 'touch', 45);
    drawStroke(canvas, 'pen', 46);
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść' }));
    const capturesBeforeTouch = pointerCapture.mock.calls.length;
    drawStroke(canvas, 'touch', 47);

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
    expect(pointerCapture).toHaveBeenCalledTimes(capturesBeforeTouch);
  });

  it('lets touch use the mode escape hatch in Piórko mode', async () => {
    useActiveRequest();
    renderPad();

    await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    const handMode = screen.getByRole('button', { name: 'Ręka' });
    tap(handMode, 'touch', 48);

    expect(handMode).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a touch submit in Piórko mode and accepts it in Ręka mode', async () => {
    const submissions: unknown[] = [];
    useActiveRequest();
    server.use(
      http.post('*/api/pad-sessions/:sessionId/submit', async ({ request }) => {
        submissions.push(await request.json());
        return HttpResponse.json({ ok: true, data: { submitted: true } });
      }),
    );
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    drawStroke(canvas, 'pen', 49);
    const submit = screen.getByRole('button', { name: 'Zatwierdź' });
    fireEvent.pointerDown(submit, { pointerId: 50, pointerType: 'touch', buttons: 1 });
    fireEvent.pointerUp(submit, { pointerId: 50, pointerType: 'touch', buttons: 0 });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    fireEvent.click(submit);
    expect(submissions).toHaveLength(0);

    tap(screen.getByRole('button', { name: 'Ręka' }), 'touch', 51);
    tap(submit, 'touch', 52);

    await waitFor(() => expect(submissions).toHaveLength(1));
  });

  it('lets a pen tap Wyczyść in Piórko mode', async () => {
    useActiveRequest();
    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    drawStroke(canvas, 'pen', 53);
    tap(screen.getByRole('button', { name: 'Wyczyść' }), 'pen', 54);

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
  });

  it('keeps a completed stroke when pointer capture is already gone', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: {
            status: 'active',
            currentRequest: {
              requestId: REQUEST_ID,
              documentTitle: 'Umowa do podpisu',
            },
          },
        }),
      ),
    );

    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 31,
      pointerType: 'pen',
      clientX: 40,
      clientY: 40,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 31,
      pointerType: 'pen',
      clientX: 120,
      clientY: 90,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 31,
      pointerType: 'pen',
      clientX: 120,
      clientY: 90,
      pressure: 0,
      buttons: 0,
    });

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
  });

  it('keeps a completed stroke when pointer release throws', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('lost capture');
      }),
    });
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: {
            status: 'active',
            currentRequest: {
              requestId: REQUEST_ID,
              documentTitle: 'Umowa do podpisu',
            },
          },
        }),
      ),
    );

    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 32,
      pointerType: 'pen',
      clientX: 50,
      clientY: 50,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 32,
      pointerType: 'pen',
      clientX: 130,
      clientY: 95,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 32,
      pointerType: 'pen',
      clientX: 130,
      clientY: 95,
      pressure: 0,
      buttons: 0,
    });

    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeEnabled();
  });

  it('surfaces pad state errors after login succeeds', async () => {
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json(
          { ok: false, error: { code: 'unauthorized', message: 'Nieprawidłowa sesja pada.' } },
          { status: 401 },
        ),
      ),
    );

    renderPad();

    expect(await screen.findByText('Nieprawidłowa sesja pada.')).toBeVisible();
  });

  it('requires a signed-in account with archive access', async () => {
    server.use(
      http.get('*/api/me', () =>
        HttpResponse.json({ ok: true, data: { ...me, tenant: null } }),
      ),
    );

    renderPad();

    expect(await screen.findByText('Zaloguj się kontem z dostępem do archiwum.')).toBeVisible();
  });

  it('submits drawn ink for the active request and returns to waiting locally', async () => {
    const submissions: unknown[] = [];
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: {
            status: 'active',
            currentRequest: {
              requestId: REQUEST_ID,
              documentTitle: 'Umowa do podpisu',
            },
          },
        }),
      ),
      http.post('*/api/pad-sessions/:sessionId/submit', async ({ request }) => {
        submissions.push(await request.json());
        return HttpResponse.json({ ok: true, data: { submitted: true } });
      }),
    );

    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 17,
      pointerType: 'mouse',
      clientX: 40,
      clientY: 40,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 17,
      pointerType: 'mouse',
      clientX: 120,
      clientY: 90,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 17,
      pointerType: 'mouse',
      clientX: 120,
      clientY: 90,
      pressure: 0,
      buttons: 0,
    });
    const submit = await screen.findByRole('button', { name: 'Zatwierdź' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(await screen.findByText('Ekran obudzi się przy następnym podpisie.')).toBeVisible();
    expect(submissions).toMatchObject([
      {
        requestId: REQUEST_ID,
        inkColor: 'black',
        sourceSize: { width: 320, height: 240 },
      },
    ]);
  });

  it('undoes, clears and reports submit failures without leaving drawing mode', async () => {
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', () =>
        HttpResponse.json({
          ok: true,
          data: {
            status: 'active',
            currentRequest: {
              requestId: REQUEST_ID,
              documentTitle: 'Umowa do podpisu',
            },
          },
        }),
      ),
      http.post('*/api/pad-sessions/:sessionId/submit', () =>
        HttpResponse.json(
          {
            ok: false,
            error: {
              code: 'validation',
              message:
                'Podpis jest zbyt duży — spróbuj krótszymi pociągnięciami.',
            },
          },
          { status: 400 },
        ),
      ),
    );

    renderPad();

    const canvas = await screen.findByRole('application', {
      name: 'Powierzchnia pada do podpisu',
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 18,
      pointerType: 'pen',
      clientX: 40,
      clientY: 40,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 18,
      pointerType: 'pen',
      clientX: 120,
      clientY: 90,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 18,
      pointerType: 'pen',
      clientX: 120,
      clientY: 90,
      pressure: 0,
      buttons: 0,
    });
    const undo = screen.getByRole('button', { name: 'Cofnij' });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();

    fireEvent.pointerDown(canvas, {
      pointerId: 19,
      pointerType: 'pen',
      clientX: 50,
      clientY: 60,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 19,
      pointerType: 'pen',
      clientX: 125,
      clientY: 92,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 19,
      pointerType: 'pen',
      clientX: 125,
      clientY: 92,
      pressure: 0,
      buttons: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść' }));
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Granatowy' }));
    fireEvent.pointerDown(canvas, {
      pointerId: 20,
      pointerType: 'pen',
      clientX: 55,
      clientY: 65,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 20,
      pointerType: 'pen',
      clientX: 135,
      clientY: 98,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 20,
      pointerType: 'pen',
      clientX: 135,
      clientY: 98,
      pressure: 0,
      buttons: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zatwierdź' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Podpis jest zbyt duży — spróbuj krótszymi pociągnięciami.',
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Umowa do podpisu' })).toBeVisible(),
    );
  });

  it('joins the signed-in user session without a fragment secret and disconnects on demand', async () => {
    let secretHeader: string | null = 'not-called';
    let disconnected = false;
    server.use(
      http.get('*/api/pad-sessions/:sessionId/state', ({ request }) => {
        secretHeader = request.headers.get('x-pad-secret');
        return HttpResponse.json({
          ok: true,
          data: {
            status: disconnected ? 'closed' : 'active',
            currentRequest: null,
          },
        });
      }),
      http.post('*/api/pad-sessions/:sessionId/disconnect', () => {
        disconnected = true;
        return HttpResponse.json({ ok: true, data: { closed: true } });
      }),
    );
    window.history.pushState(null, '', `/pad/${SESSION_ID}`);
    renderPad();

    fireEvent.click(await screen.findByRole('button', { name: 'Rozłącz' }));

    expect(await screen.findByText('Pad rozłączony')).toBeVisible();
    expect(secretHeader).toBeNull();
  });
});
