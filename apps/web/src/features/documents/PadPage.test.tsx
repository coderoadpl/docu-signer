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
    const closeSessionButton = screen.getByRole('button', { name: 'Zamknij sesję' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij sesję' }));
    expect(closeSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('PadPage', () => {
  beforeEach(() => {
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
      value: vi.fn(),
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
    expect(screen.getByText('Zeskanowano. Ekran obudzi się przy następnym podpisie.')).toBeVisible();
  });

  it('renders the drawing state when the desktop requests a signature', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Umowa do podpisu' })).toBeVisible();
    expect(screen.getByRole('application', { name: 'Powierzchnia pada do podpisu' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wyczyść' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zatwierdź' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Granatowy' })).toBeEnabled();
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
      pointerType: 'touch',
      clientX: 40,
      clientY: 40,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 17,
      pointerType: 'touch',
      clientX: 120,
      clientY: 90,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 17,
      pointerType: 'touch',
      clientX: 120,
      clientY: 90,
      pressure: 0,
      buttons: 0,
    });
    const submit = await screen.findByRole('button', { name: 'Zatwierdź' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(await screen.findByText('Zeskanowano. Ekran obudzi się przy następnym podpisie.')).toBeVisible();
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
          { ok: false, error: { code: 'validation', message: 'Za dużo danych podpisu.' } },
          { status: 422 },
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
      pointerType: 'touch',
      clientX: 50,
      clientY: 60,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 19,
      pointerType: 'touch',
      clientX: 125,
      clientY: 92,
      pressure: 0.5,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 19,
      pointerType: 'touch',
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

    expect(await screen.findByRole('alert')).toHaveTextContent('Za dużo danych podpisu.');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Umowa do podpisu' })).toBeVisible(),
    );
  });

  it('surfaces missing secrets and pad state errors', async () => {
    window.history.pushState(null, '', `/pad/${SESSION_ID}`);
    renderPad();
    expect(await screen.findByText('Brak sekretu sesji na adresie pada.')).toBeVisible();
  });
});
