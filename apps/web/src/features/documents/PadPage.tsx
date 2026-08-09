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
  SIGNING_INK_COLORS,
  inkToCanvasOutlines,
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

const selectionLockSx = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
} as const;

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
  for (const outline of inkToCanvasOutlines(strokes, DEFAULT_PLACEMENT, metrics)) {
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
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();
  const [inkColorId, setInkColorId] = useState<SigningInkColorId>(
    DEFAULT_SIGNING_INK_COLOR.id,
  );
  const [submittedRequestId, setSubmittedRequestId] = useState<string>();
  const [requestCount, setRequestCount] = useState(0);
  const lastRequestIdRef = useRef<string | undefined>(undefined);
  const me = useQuery(actions.me);
  const state = useQuery({
    ...actions.padSessionState(sessionId, secret),
    enabled: Boolean(secret) && Boolean(me.data?.tenant),
    refetchInterval: POLL_MS,
  });
  const submit = useMutation(actions.submitPadStrokes);
  const inkColor = signingInkColorById(inkColorId);
  const request = state.data?.currentRequest ?? null;
  const drawingRequest =
    request && request.requestId !== submittedRequestId ? request : null;

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
  }, [request]);

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

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    releasePointerCapture(event.currentTarget, event.pointerId);
    const stroke = currentStrokeRef.current;
    if (stroke?.points.length) setStrokes((current) => [...current, stroke]);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    setActiveStroke(undefined);
    event.preventDefault();
  };

  const clearInk = () => {
    setStrokes([]);
    setActiveStroke(undefined);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
  };

  const submitInk = async () => {
    if (!drawingRequest || !metrics || !strokes.length) return;
    try {
      await submit.mutateAsync({
        sessionId,
        secret,
        input: {
          requestId: drawingRequest.requestId,
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
    setSubmittedRequestId(drawingRequest.requestId);
    clearInk();
    await queryClient.invalidateQueries(actions.padSessionInvalidates(sessionId));
  };

  if (!secret) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'error', message: 'Brak sekretu sesji na adresie pada.' }} />
      </PadFrame>
    );
  }

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

  if (state.isError) {
    return (
      <PadFrame>
        <StatusView state={{ kind: 'error', message: state.error.message }} />
      </PadFrame>
    );
  }

  return (
    <Box
      sx={{
        ...selectionLockSx,
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'none',
        '& *': selectionLockSx,
      }}
    >
      <Paper square sx={{ px: 2, py: 1.25 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1.5 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h2" noWrap>
              {drawingRequest?.documentTitle ?? 'Czekam na dokument…'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Dokument {requestCount || 1}
            </Typography>
          </Box>
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
                disabled={!drawingRequest || submit.isPending}
                aria-label={color.label}
              >
                {color.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      </Paper>
      <Box sx={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
        {!drawingRequest ? (
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
            {state.isFetching ? <CircularProgress size={28} /> : null}
            <Typography variant="h1">Czekam na dokument…</Typography>
            <Typography variant="body2" color="text.secondary">
              Zeskanowano. Ekran obudzi się przy następnym podpisie.
            </Typography>
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
            display: drawingRequest ? 'block' : 'none',
            touchAction: 'none',
            cursor: 'crosshair',
          }}
          onPointerDown={(event) => {
            if (!drawingRequest || submit.isPending) return;
            const stroke = strokeForEvent(event);
            if (!stroke.points.length) return;
            activePointerRef.current = event.pointerId;
            currentStrokeRef.current = stroke;
            setActiveStroke(stroke);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
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
      {drawingRequest ? (
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
