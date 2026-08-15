import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  SvgIcon,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { InkSurface } from '../../theme.js';
import {
  DEFAULT_SIGNING_INK_COLOR,
  PAD_PREVIEW_INK_SIZE,
  SIGNING_INK_COLORS,
  inkToCanvasOutlines,
  penPriorityActive,
  pointerDrawsInk,
  pointerEventToInkPoints,
  pointerEventUsesSimulatedPressure,
  signingInkColorById,
  type CanvasPdfMetrics,
  type InkOutlinePoint,
  type InkStroke,
  type SigningInkColorId,
} from './signing.js';

const DEFAULT_PLACEMENT = { offsetX: 0, offsetY: 0, scale: 1 };
const POLL_MS = 1200;

type PadInputMode = 'pen' | 'hand';

const selectionLockSx = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
} as const;

const PenIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm17.71-10.04a.996.996 0 0 0 0-1.41l-2.5-2.5a.996.996 0 0 0-1.41 0l-1.96 1.96 3.75 3.75 2.12-1.8Z" />
  </SvgIcon>
);

const HandIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M18 11V6a2 2 0 0 0-4 0v4h-1V4a2 2 0 0 0-4 0v6H8V5a2 2 0 0 0-4 0v9.5l-1.2-1.2a2 2 0 0 0-2.8 2.8l5.7 5.7A4 4 0 0 0 8.5 23H16a6 6 0 0 0 6-6v-6a2 2 0 0 0-4 0Z" />
  </SvgIcon>
);

const modeSwitchContains = (target: EventTarget): boolean =>
  target instanceof Element && target.closest('[data-pad-mode-switch]') !== null;

const releasePointerCapture = (element: HTMLCanvasElement, pointerId: number) => {
  if (typeof element.releasePointerCapture !== 'function') return;
  if (
    typeof element.hasPointerCapture === 'function' &&
    !element.hasPointerCapture(pointerId)
  ) {
    return;
  }
  try {
    element.releasePointerCapture(pointerId);
  } catch {
    return;
  }
};

const drawOutline = (
  context: CanvasRenderingContext2D,
  points: readonly InkOutlinePoint[],
) => {
  const first = points[0];
  const second = points[1];
  const third = points[2];
  if (!first || !second || !third || points.length < 4) return;

  context.beginPath();
  context.moveTo(first.x, first.y);
  context.quadraticCurveTo(
    second.x,
    second.y,
    (second.x + third.x) / 2,
    (second.y + third.y) / 2,
  );
  for (let index = 2; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    context.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) / 2,
      (point.y + next.y) / 2,
    );
  }
  context.closePath();
  context.fill();
};

const canvasMetrics = (canvas: HTMLCanvasElement): CanvasPdfMetrics | undefined => {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.max(1, Math.floor(bounds.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(bounds.height * devicePixelRatio));
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  return {
    cssWidth: bounds.width,
    cssHeight: bounds.height,
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    devicePixelRatio,
    viewportTransform: [1, 0, 0, -1, 0, bounds.height] as const,
  };
};

const drawPadInk = (
  canvas: HTMLCanvasElement,
  strokes: InkStroke[],
  metrics: CanvasPdfMetrics,
  color: string,
) => {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  for (const outline of inkToCanvasOutlines(
    strokes,
    DEFAULT_PLACEMENT,
    metrics,
    PAD_PREVIEW_INK_SIZE,
  )) {
    drawOutline(context, outline.points);
  }
};

const secretFromHash = (): string => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ''));
  return params.get('s') ?? '';
};

const authErrorCode = (error: Error | null): string | null =>
  error instanceof ApiError ? error.appError.code : null;

export const PadPage = ({ sessionId }: { sessionId: string }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const secret = useRef(secretFromHash()).current;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStrokeRef = useRef<InkStroke | undefined>(undefined);
  const activePointerRef = useRef<number | undefined>(undefined);
  const activePointerTypeRef = useRef<string | undefined>(undefined);
  const activePenPointerRef = useRef<number | undefined>(undefined);
  const lastPenSeenAtRef = useRef<number | undefined>(undefined);
  const suppressNextTouchClickRef = useRef(false);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();
  const [inkColorId, setInkColorId] = useState<SigningInkColorId>(
    DEFAULT_SIGNING_INK_COLOR.id,
  );
  const [inputMode, setInputMode] = useState<PadInputMode>('pen');
  const [submittedRequestId, setSubmittedRequestId] = useState<string>();
  const [disconnected, setDisconnected] = useState(false);
  const [requestCount, setRequestCount] = useState(0);
  const lastRequestIdRef = useRef<string | undefined>(undefined);
  const me = useQuery(actions.me);
  const state = useQuery({
    ...actions.padSessionState(sessionId, secret),
    enabled: Boolean(me.data?.tenant) && !disconnected,
    refetchInterval: POLL_MS,
  });
  const submit = useMutation(actions.submitPadStrokes);
  const disconnect = useMutation(actions.disconnectPadSession);
  const inkColor = signingInkColorById(inkColorId);
  const request = state.data?.currentRequest ?? null;
  const drawingRequest =
    request && request.requestId !== submittedRequestId ? request : null;
  const sharedDocument =
    state.data?.mode === 'shared' ? state.data.currentDocument : null;
  const drawingEnabled = Boolean(drawingRequest || sharedDocument);
  const activeDocumentKey = sharedDocument?.key;
  const lastDocumentKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (authErrorCode(me.error) === 'unauthorized') void navigate({ to: '/login' });
  }, [me.error, navigate]);

  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasElement(node);
  }, []);

  useEffect(() => {
    if (!canvasElement) return;
    const updateMetrics = () => {
      if (canvasRef.current !== canvasElement) return;
      const next = canvasMetrics(canvasElement);
      if (next) setMetrics(next);
    };
    updateMetrics();
    const animationFrame = window.requestAnimationFrame(updateMetrics);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateMetrics);
    observer?.observe(canvasElement);
    window.addEventListener('resize', updateMetrics);
    window.addEventListener('orientationchange', updateMetrics);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      window.removeEventListener('resize', updateMetrics);
      window.removeEventListener('orientationchange', updateMetrics);
    };
  }, [canvasElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !metrics) return;
    drawPadInk(
      canvas,
      activeStroke ? [...strokes, activeStroke] : strokes,
      metrics,
      inkColor.canvasColor,
    );
  }, [activeStroke, inkColor.canvasColor, metrics, strokes]);

  useEffect(() => {
    if (!request) return;
    if (lastRequestIdRef.current === request.requestId) return;
    lastRequestIdRef.current = request.requestId;
    setRequestCount((current) => current + 1);
    setSubmittedRequestId(undefined);
    setStrokes([]);
    setActiveStroke(undefined);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    activePenPointerRef.current = undefined;
    lastPenSeenAtRef.current = undefined;
  }, [request]);

  useEffect(() => {
    if (!activeDocumentKey || lastDocumentKeyRef.current === activeDocumentKey) return;
    lastDocumentKeyRef.current = activeDocumentKey;
    setStrokes([]);
    setActiveStroke(undefined);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
  }, [activeDocumentKey]);

  const pointsForEvent = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    pointerEventToInkPoints(
      event.nativeEvent,
      event.currentTarget.getBoundingClientRect(),
    );

  const strokeForEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => ({
    points: pointsForEvent(event),
    simulatePressure: pointerEventUsesSimulatedPressure(
      event.nativeEvent,
      event.pointerType,
    ),
  });

  const touchIgnoredForPenPriority = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) =>
    event.pointerType === 'touch' &&
    penPriorityActive({
      activePenPointerId: activePenPointerRef.current,
      lastPenSeenAt: lastPenSeenAtRef.current,
      now: event.timeStamp,
    });

  const eventDrawsInk = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    pointerDrawsInk({
      fingerDrawing: inputMode === 'hand',
      mode: 'draw',
      penPriority: touchIgnoredForPenPriority(event),
      pointer: { pointerType: event.pointerType },
    });

  const cancelActiveTouchStroke = (canvas: HTMLCanvasElement) => {
    if (activePointerTypeRef.current !== 'touch') return;
    const pointerId = activePointerRef.current;
    if (pointerId !== undefined) releasePointerCapture(canvas, pointerId);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    setActiveStroke(undefined);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePenPointerRef.current === event.pointerId) {
      activePenPointerRef.current = undefined;
      lastPenSeenAtRef.current = event.timeStamp;
    }
    if (activePointerRef.current !== event.pointerId) return;
    releasePointerCapture(event.currentTarget, event.pointerId);
    const stroke = currentStrokeRef.current;
    if (stroke?.points.length) setStrokes((current) => [...current, stroke]);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    setActiveStroke(undefined);
    event.preventDefault();
  };

  const clearInk = () => {
    setStrokes([]);
    setActiveStroke(undefined);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
  };

  const suppressTouchPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inputMode !== 'pen' || event.pointerType !== 'touch') {
      suppressNextTouchClickRef.current = false;
      return;
    }
    if (modeSwitchContains(event.target)) {
      suppressNextTouchClickRef.current = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressNextTouchClickRef.current = true;
  };

  const submitInk = async () => {
    if (!drawingEnabled || !metrics || !strokes.length) return;
    try {
      await submit.mutateAsync({
        sessionId,
        secret,
        input: {
          ...(drawingRequest ? { requestId: drawingRequest.requestId } : {}),
          strokes,
          inkColor: inkColorId,
          sourceSize: {
            width: metrics.cssWidth,
            height: metrics.cssHeight,
          },
        },
      });
    } catch {
      return;
    }
    if (drawingRequest) setSubmittedRequestId(drawingRequest.requestId);
    clearInk();
    await queryClient.invalidateQueries(actions.padSessionInvalidates(sessionId));
  };

  const disconnectPad = async () => {
    try {
      await disconnect.mutateAsync({ sessionId, secret });
      setDisconnected(true);
      await queryClient.invalidateQueries(actions.padSessionInvalidates(sessionId));
    } catch {
      return;
    }
  };

  if (me.isPending) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'loading', label: 'Sprawdzam logowanie…' }} />
      </PadFrame>
    );
  }

  if (me.isError || !me.data?.tenant) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'error', message: 'Zaloguj się kontem z dostępem do archiwum.' }} />
      </PadFrame>
    );
  }

  if (state.isPending) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'loading', label: 'Ładowanie pada…' }} />
      </PadFrame>
    );
  }

  if (state.isError) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'error', message: state.error.message }} />
      </PadFrame>
    );
  }

  if (disconnected || state.data.status === 'closed') {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'empty', title: 'Pad rozłączony' }} />
      </PadFrame>
    );
  }

  return (
    <Box
      onPointerDownCapture={suppressTouchPointer}
      onPointerUpCapture={suppressTouchPointer}
      onClickCapture={(event) => {
        const touchClick =
          'pointerType' in event.nativeEvent &&
          event.nativeEvent.pointerType === 'touch';
        if (
          inputMode !== 'pen' ||
          modeSwitchContains(event.target) ||
          (!touchClick && !suppressNextTouchClickRef.current)
        ) {
          return;
        }
        suppressNextTouchClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      sx={{
        ...(inputMode === 'pen' ? selectionLockSx : {}),
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'none',
        ...(inputMode === 'pen' ? { '& *': selectionLockSx } : {}),
      }}
    >
      <Paper square sx={{ px: 2, py: 1.25 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2" noWrap>
              {sharedDocument
                ? 'Możesz złożyć podpis'
                : drawingRequest?.documentTitle ?? 'Czekam na dokument…'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {sharedDocument?.title ?? `Dokument ${requestCount || 1}`}
            </Typography>
            {sharedDocument && drawingRequest ? (
              <Typography variant="caption" color="text.secondary">
                Prośba o podpis
              </Typography>
            ) : null}
          </Box>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={inkColorId}
              onChange={(_, selected: SigningInkColorId | null) => {
                if (selected) setInkColorId(selected);
              }}
              aria-label="Kolor tuszu pada"
            >
              {SIGNING_INK_COLORS.map((color) => (
                <ToggleButton
                  key={color.id}
                  value={color.id}
                  disabled={!drawingEnabled || submit.isPending}
                  aria-label={color.label}
                >
                  {color.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Box data-pad-mode-switch>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={inputMode}
                onChange={(_, selected: PadInputMode | null) => {
                  if (!selected) return;
                  if (selected === 'pen' && canvasRef.current) {
                    cancelActiveTouchStroke(canvasRef.current);
                  }
                  setInputMode(selected);
                }}
                aria-label="Tryb wejścia pada"
              >
                <ToggleButton value="pen" aria-label="Piórko">
                  <Stack component="span" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
                    <PenIcon />
                    Piórko
                  </Stack>
                </ToggleButton>
                <ToggleButton value="hand" aria-label="Ręka">
                  <Stack component="span" direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
                    <HandIcon />
                    Ręka
                  </Stack>
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Stack>
        </Stack>
      </Paper>
      <Box sx={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
        {!drawingEnabled ? (
          <Stack
            sx={{
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              px: 2,
            }}
          >
            <Typography variant="h1">Czekam na dokument…</Typography>
            <Typography variant="body2" color="text.secondary">
              Ekran obudzi się przy następnym podpisie.
            </Typography>
            {disconnect.isError ? <Alert severity="error">{disconnect.error.message}</Alert> : null}
            <Button
              color="error"
              variant="outlined"
              disabled={disconnect.isPending}
              onClick={() => void disconnectPad()}
            >
              Rozłącz
            </Button>
          </Stack>
        ) : null}
        <InkSurface
          ref={setCanvasRef}
          role="application"
          aria-label="Powierzchnia pada do podpisu"
          tabIndex={0}
          sx={{
            width: '100%',
            height: '100%',
            display: drawingEnabled ? 'block' : 'none',
            touchAction: 'none',
            cursor: 'crosshair',
          }}
          onPointerDown={(event) => {
            if (!drawingEnabled || submit.isPending) return;
            if (event.pointerType === 'pen') {
              activePenPointerRef.current = event.pointerId;
              lastPenSeenAtRef.current = event.timeStamp;
              cancelActiveTouchStroke(event.currentTarget);
            }
            if (activePointerRef.current !== undefined) return;
            if (!eventDrawsInk(event)) {
              if (event.pointerType === 'touch') event.preventDefault();
              return;
            }
            const stroke = strokeForEvent(event);
            if (!stroke.points.length) return;
            activePointerRef.current = event.pointerId;
            activePointerTypeRef.current = event.pointerType;
            currentStrokeRef.current = stroke;
            setActiveStroke(stroke);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'pen') {
              lastPenSeenAtRef.current = event.timeStamp;
            }
            if (touchIgnoredForPenPriority(event)) {
              cancelActiveTouchStroke(event.currentTarget);
              event.preventDefault();
              return;
            }
            if (activePointerRef.current !== event.pointerId) return;
            const current = currentStrokeRef.current;
            if (!current) return;
            const next = { ...current, points: [...current.points, ...pointsForEvent(event)] };
            currentStrokeRef.current = next;
            setActiveStroke(next);
            event.preventDefault();
          }}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
      </Box>
      {drawingEnabled ? (
        <Paper square sx={{ px: 2, py: 1.25 }}>
          {submit.isError ? <Alert severity="error" sx={{ mb: 1 }}>{submit.error.message}</Alert> : null}
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={() => setStrokes((current) => current.slice(0, -1))} disabled={!strokes.length || submit.isPending}>
              Cofnij
            </Button>
            <Button onClick={clearInk} disabled={(!strokes.length && !activeStroke) || submit.isPending}>
              Wyczyść
            </Button>
            <Button
              variant="contained"
              onClick={() => void submitInk()}
              disabled={!strokes.length || !metrics || submit.isPending}
              startIcon={submit.isPending ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {submit.isPending ? 'Wysyłam…' : 'Zatwierdź'}
            </Button>
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
};

const PadFrame = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      p: 2,
    }}
  >
    {children}
  </Box>
);
