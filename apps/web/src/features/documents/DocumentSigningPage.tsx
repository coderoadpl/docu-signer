import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import QRCode from 'qrcode';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Popover,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import {
  type DocumentWithFiles,
  type PadParticipant,
  type PadQueuedSubmission,
  type PadSubmittedStrokes,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SigningShell } from '../../components/layout/SigningShell.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { appNoticeStore } from '../../lib/app-notice.js';
import { InkSurface, PadStatusDot, SigningPageSurface } from '../../theme.js';
import {
  DEFAULT_SIGNING_INK_COLOR,
  DEFAULT_SIGNING_INK_SIZE,
  MAX_SIGNING_INK_SIZE,
  MIN_SIGNING_INK_SIZE,
  SIGNING_INK_COLORS,
  appendSigningStamp,
  clampSignaturePlacementToPage,
  createSigningStamp,
  defaultSignaturePlacement,
  defaultSigningGestureMode,
  pointerDrawsInk,
  fitInkStrokesToPage,
  inkToCanvasOutlines,
  isPalmSizedTouch,
  moveSigningStampToPage,
  penPriorityActive,
  pointerEventToInkPoints,
  pointerEventUsesSimulatedPressure,
  placedInkBounds,
  removeSigningStamp,
  signingStampContainsPoint,
  signingStampsForPage,
  signedFileName,
  signedDigitalSourceHint,
  signingInkColorById,
  stampEveryPage,
  updateSigningStampPlacement,
  type InkOutlinePoint,
  type CanvasPdfMetrics,
  type InkStroke,
  type SignaturePlacement,
  type SigningGestureMode,
  type SigningInkColorId,
  type SigningStamp,
} from './signing.js';
import {
  DOCUMENT_TYPE_LABELS,
  canSignPdfFile,
  documentsSearchFromSigningSearch,
  massSigningQueueSearch,
  signingQueueFromSearch,
  uploadErrorMessage,
} from './documents.logic.js';
import {
  flattenSignedPdf,
  loadSourcePdf,
  renderSourcePage,
  sourcePageMetrics,
} from './signing-pdf.js';
import { uploadDocumentFile } from './upload.logic.js';
import { storeSignatureRecordAfterUpload } from './signature-record.logic.js';

type LoadedPdf = Awaited<ReturnType<typeof loadSourcePdf>>;

const DEFAULT_PLACEMENT: SignaturePlacement = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

const FileLoadingOverlay = () => (
  <Box
    sx={{
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeItems: 'center',
      zIndex: 2,
      pointerEvents: 'none',
    }}
  >
    <CircularProgress aria-label="Ładowanie podglądu pliku" />
  </Box>
);

const detectDefaultGestureMode = (): SigningGestureMode =>
  defaultSigningGestureMode({
    coarsePointer:
      typeof window !== 'undefined'
        ? window.matchMedia?.('(pointer: coarse)').matches ?? false
        : false,
    maxTouchPoints:
      typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
  });

const bytesAsArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

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

const buttonTouchSx = { touchAction: 'manipulation' } as const;
const selectionLockSx = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
} as const;
const dialogSelectionLockSx = {
  ...selectionLockSx,
  '& *': selectionLockSx,
} as const;

const BusyButtonProgress = () => (
  <CircularProgress size={18} color="inherit" aria-hidden="true" />
);

interface RemotePadSession {
  id: string;
  url: string;
  mode: 'private' | 'shared';
  lastPolledAt: string | null;
  participants: PadParticipant[];
  pendingRequestId: string | null;
  pendingTargetKey: string | null;
  fulfilledTargetKey: string | null;
}

const REMOTE_PAD_POLL_MS = 1200;

const padUrlForSession = (sessionId: string, secret: string): string => {
  if (!secret) return `${window.location.origin}/pad/${encodeURIComponent(sessionId)}`;
  // WHY: the pad secret lives in the fragment so normal HTTP requests and server logs never receive it.
  return `${window.location.origin}/pad/${encodeURIComponent(sessionId)}#s=${encodeURIComponent(secret)}`;
};

const remotePadConnected = (lastPolledAt: string | null): boolean =>
  lastPolledAt !== null && Date.now() - Date.parse(lastPolledAt) < 5000;

const sharedPadConnected = (participants: PadParticipant[]): boolean =>
  participants.some((participant) => remotePadConnected(participant.lastPolledAt));

const remoteStrokesToInkStrokes = (
  strokes: PadSubmittedStrokes['strokes'],
): InkStroke[] =>
  strokes.map((stroke) => ({
    ...(stroke.simulatePressure === undefined
      ? {}
      : { simulatePressure: stroke.simulatePressure }),
    points: stroke.points.map((point) => ({ ...point })),
  }));

interface InkLayer {
  strokes: InkStroke[];
  placement: SignaturePlacement;
  color: string;
  selected: boolean;
  inkSize?: number;
}

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M6 6l12 12M18 6L6 18"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
);

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

const drawInk = (
  canvas: HTMLCanvasElement,
  layers: InkLayer[],
  metrics: CanvasPdfMetrics,
) => {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const layer of layers) {
    context.fillStyle = layer.color;
    for (const outline of inkToCanvasOutlines(
      layer.strokes,
      layer.placement,
      metrics,
      layer.inkSize,
    )) {
      drawOutline(context, outline.points);
    }
    if (layer.selected) {
      const bounds = placedInkBounds(layer.strokes, layer.placement);
      if (bounds) {
        context.save();
        context.strokeStyle = '#1976d2';
        context.lineWidth = 2 * metrics.devicePixelRatio;
        context.setLineDash([6 * metrics.devicePixelRatio, 4 * metrics.devicePixelRatio]);
        context.strokeRect(
          bounds.left * canvas.width,
          bounds.top * canvas.height,
          (bounds.right - bounds.left) * canvas.width,
          (bounds.bottom - bounds.top) * canvas.height,
        );
        context.restore();
      }
    }
  }
};

const canvasMetrics = (canvas: HTMLCanvasElement): CanvasPdfMetrics | undefined => {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return undefined;
  const cssWidth = bounds.width;
  const cssHeight = bounds.height;
  const devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.max(1, Math.floor(cssWidth * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(cssHeight * devicePixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return {
    cssWidth,
    cssHeight,
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    devicePixelRatio,
    viewportTransform: [1, 0, 0, -1, 0, cssHeight] as const,
  };
};

const SignaturePadDialog = ({
  inkColorId,
  inkColor,
  onCancel,
  onInkColorChange,
  onUse,
  open,
}: {
  inkColorId: SigningInkColorId;
  inkColor: ReturnType<typeof signingInkColorById>;
  onCancel: () => void;
  onInkColorChange: (colorId: SigningInkColorId) => void;
  onUse: (
    strokes: InkStroke[],
    sourceSize: { width: number; height: number },
  ) => void;
  open: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStrokeRef = useRef<InkStroke | undefined>(undefined);
  const activePointerRef = useRef<number | undefined>(undefined);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();

  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasElement(node);
  }, []);

  useEffect(() => {
    if (!open) return;
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    setStrokes([]);
    setActiveStroke(undefined);
    setMetrics(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!canvasElement) return;
    const updateMetrics = () => {
      if (canvasRef.current !== canvasElement) return;
      const next = canvasMetrics(canvasElement);
      if (next) setMetrics(next);
    };
    updateMetrics();
    const animationFrame = window.requestAnimationFrame(updateMetrics);
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMetrics);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', updateMetrics);
      };
    }
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(canvasElement);
    window.addEventListener('resize', updateMetrics);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [canvasElement, open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !metrics) return;
    drawInk(
      canvas,
      strokes.length || activeStroke
        ? [
            {
              strokes: activeStroke ? [...strokes, activeStroke] : strokes,
              placement: DEFAULT_PLACEMENT,
              color: inkColor.canvasColor,
              selected: false,
            },
          ]
        : [],
      metrics,
    );
  }, [activeStroke, inkColor.canvasColor, metrics, strokes]);

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

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { sx: dialogSelectionLockSx } }}
    >
      <DialogTitle sx={selectionLockSx}>Złóż podpis</DialogTitle>
      <DialogContent sx={selectionLockSx}>
        <InkSurface
          ref={setCanvasRef}
          role="application"
          aria-label="Powierzchnia do złożenia podpisu"
          tabIndex={0}
          sx={{
            width: '100%',
            height: { xs: 220, sm: 280 },
            display: 'block',
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
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
            const points = pointsForEvent(event);
            const next = {
              ...current,
              points: [...current.points, ...points],
            };
            currentStrokeRef.current = next;
            setActiveStroke(next);
            event.preventDefault();
          }}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
      </DialogContent>
      <DialogActions
        sx={{
          flexWrap: 'wrap',
          gap: 1,
          touchAction: 'manipulation',
          ...selectionLockSx,
        }}
      >
        <Button
          onClick={() => setStrokes((current) => current.slice(0, -1))}
          disabled={!strokes.length}
          sx={buttonTouchSx}
        >
          Cofnij
        </Button>
        <Button
          onClick={() => {
            setStrokes([]);
            setActiveStroke(undefined);
            currentStrokeRef.current = undefined;
            activePointerRef.current = undefined;
          }}
          disabled={!strokes.length && !activeStroke}
          sx={buttonTouchSx}
        >
          Wyczyść
        </Button>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={inkColorId}
          onChange={(_, selected: SigningInkColorId | null) => {
            if (selected) onInkColorChange(selected);
          }}
          aria-label="Kolor tuszu podpisu"
        >
          {SIGNING_INK_COLORS.map((color) => (
            <ToggleButton key={color.id} value={color.id} aria-label={color.label}>
              {color.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onCancel} sx={buttonTouchSx}>
          Anuluj
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            const bounds = canvasRef.current?.getBoundingClientRect();
            onUse(strokes, {
              width: bounds?.width ?? metrics?.cssWidth ?? 1,
              height: bounds?.height ?? metrics?.cssHeight ?? 1,
            });
          }}
          disabled={!strokes.length || !metrics}
          sx={buttonTouchSx}
        >
          Użyj podpisu
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const PadQrDialog = ({
  error,
  loading,
  onClose,
  onCloseSession,
  open,
  qrDataUrl,
  sessionUrl,
}: {
  error?: string;
  loading: boolean;
  onClose: () => void;
  onCloseSession: () => void;
  open: boolean;
  qrDataUrl?: string;
  sessionUrl?: string;
}) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>Pad QR</DialogTitle>
    <DialogContent>
      <Stack sx={{ alignItems: 'center', gap: 2, py: 1 }}>
        {loading ? <CircularProgress aria-label="Tworzenie sesji pada" /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
        {qrDataUrl ? (
          <Box
            component="img"
            src={qrDataUrl}
            alt="Kod QR pada podpisu"
            sx={{
              width: 220,
              height: 220,
              imageRendering: 'pixelated',
            }}
          />
        ) : null}
        {sessionUrl ? (
          <Typography variant="body2" color="text.secondary" align="center">
            Zeskanuj kod aparatem telefonu lub tabletu (najlepiej tablet z rysikiem).
            Może dołączyć każde konto organizacji.
          </Typography>
        ) : null}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Schowaj kod QR</Button>
      <Button color="error" onClick={onCloseSession} disabled={!sessionUrl}>
        Zakończ całą sesję
      </Button>
    </DialogActions>
  </Dialog>
);

const RemotePadStatusIndicator = ({
  connected,
  onOpen,
}: {
  connected: boolean;
  onOpen: () => void;
}) =>
  connected ? (
    <Button
      color="success"
      onClick={onOpen}
      variant="text"
      aria-live="polite"
      startIcon={<PadStatusDot aria-hidden="true" className="connected" />}
      sx={{ alignSelf: 'center', minHeight: 36, px: 1 }}
    >
      Pad połączony
    </Button>
  ) : (
    <Stack
      direction="row"
      aria-live="polite"
      sx={{ alignItems: 'center', alignSelf: 'center', gap: 0.75, minHeight: 36, px: 1 }}
    >
      <PadStatusDot aria-hidden="true" />
      <Typography variant="body2" color="text.secondary">
        Pad: oczekuje
      </Typography>
    </Stack>
  );

const IncomingSignatureTray = ({
  anchor,
  onClose,
  onDiscard,
  onMaterialize,
  onOpen,
  submissions,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  onDiscard: (submission: PadQueuedSubmission) => void;
  onMaterialize: (submission: PadQueuedSubmission) => void;
  onOpen: (element: HTMLElement) => void;
  submissions: PadQueuedSubmission[];
}) => {
  if (submissions.length === 0) return null;
  const counts = new Map<string, { label: string; count: number }>();
  for (const submission of submissions) {
    const contributor = submission.contributedBy;
    const current = counts.get(contributor.accountId);
    counts.set(contributor.accountId, {
      label: contributor.label,
      count: (current?.count ?? 0) + 1,
    });
  }
  const summary = [...counts.values()]
    .map(({ count, label }) => `${label} (${count})`)
    .join(' · ');
  return (
    <>
      <Button
        size="small"
        variant="text"
        onClick={(event) => onOpen(event.currentTarget)}
        sx={{ minHeight: 36, px: 1 }}
      >
        Podpisy: {summary}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={onClose}
        anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
      >
        <Stack sx={{ minWidth: 310, maxWidth: 420, p: 1 }}>
          <Typography variant="subtitle2" sx={{ px: 1, py: 0.75 }}>
            Podpisy do umieszczenia
          </Typography>
          {submissions.map((submission, index) => (
            <Stack
              key={submission.id}
              direction="row"
              sx={{ alignItems: 'center', gap: 1, px: 1, py: 0.5 }}
            >
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {submission.contributedBy.label} · podpis {index + 1}
              </Typography>
              <Button size="small" onClick={() => onMaterialize(submission)}>
                Umieść
              </Button>
              <Button color="error" size="small" onClick={() => onDiscard(submission)}>
                Odrzuć
              </Button>
            </Stack>
          ))}
        </Stack>
      </Popover>
    </>
  );
};

const PageHeader = ({
  fileName,
  onClose,
}: {
  fileName: string;
  onClose: () => void;
}) => (
  <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1.5 }}>
    <Stack
      direction="row"
      sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
    >
      <Box>
        <Typography variant="h1">Podpisz dokument</Typography>
        <Typography variant="body2">{fileName}</Typography>
      </Box>
      <Button onClick={onClose}>Zamknij</Button>
    </Stack>
  </Paper>
);

const EmptyControls = () => <Box />;

const MassReviewHeader = ({
  document,
  onClose,
}: {
  document: {
    docType: keyof typeof DOCUMENT_TYPE_LABELS;
    person?: string | null;
    tags: string[];
    title: string;
  };
  onClose: () => void;
}) => (
  <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1 }}>
    <Stack
      direction="row"
      sx={{
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <Typography
        variant="h3"
        component="h1"
        noWrap
        sx={{ flex: '0 1 auto', maxWidth: { xs: '50vw', sm: '58vw', md: '64vw' }, minWidth: 0 }}
      >
        {document.title}
      </Typography>
      <Chip
        size="small"
        variant="outlined"
        label={DOCUMENT_TYPE_LABELS[document.docType]}
      />
      {document.person ? <Chip size="small" label={document.person} /> : null}
      {document.tags.map((tag) => (
        <Chip key={tag} size="small" label={tag} />
      ))}
      <Box sx={{ flexGrow: 1 }} />
      <IconButton
        aria-label="Zamknij"
        onClick={onClose}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <CloseIcon />
      </IconButton>
    </Stack>
  </Paper>
);

const MassSummary = ({
  onReturn,
  signedCount,
  skippedCount,
}: {
  onReturn: () => void;
  signedCount: number;
  skippedCount: number;
}) => (
  <SigningShell
    header={<EmptyControls />}
    controls={<EmptyControls />}
    footer={
      <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={onReturn}>
            Wróć do listy
          </Button>
        </Stack>
      </Paper>
    }
    fitMain
  >
    <Stack sx={{ alignItems: 'center', gap: 2 }}>
      <Typography variant="h1" align="center">Podsumowanie</Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Chip color="success" label={`Podpisano ${signedCount}`} />
        <Chip variant="outlined" label={`Pominięto ${skippedCount}`} />
      </Stack>
    </Stack>
  </SigningShell>
);

const StampPlacementControls = ({
  activeInkSize,
  activePlacement,
  committing,
  contributorLabel,
  label,
  onInkSizeChange,
  onPageChange,
  onRemove,
  onResize,
  removeDisabled,
  sliderId,
  thicknessSliderId,
  marginBottom,
  marginTop,
  pageCount,
  pageIndex,
}: {
  activeInkSize?: number;
  activePlacement: SignaturePlacement;
  committing: boolean;
  contributorLabel?: string;
  label: string;
  marginBottom?: number;
  marginTop?: number;
  onInkSizeChange?: (inkSize: number) => void;
  onPageChange?: (pageIndex: number) => void;
  onRemove: () => void;
  onResize: (placement: SignaturePlacement) => void;
  removeDisabled: boolean;
  sliderId: string;
  thicknessSliderId?: string;
  pageCount?: number;
  pageIndex?: number;
}) => (
  <Stack
    direction="row"
    sx={{
      alignItems: 'center',
      gap: 2,
      flexWrap: 'wrap',
      mb: marginBottom,
      mt: marginTop,
    }}
  >
    <Typography id={sliderId}>Rozmiar</Typography>
    <Slider
      aria-labelledby={sliderId}
      disabled={committing}
      min={50}
      max={200}
      value={Math.round(activePlacement.scale * 100)}
      valueLabelDisplay="auto"
      valueLabelFormat={(value) => `${value}%`}
      onChange={(_, value) => {
        if (typeof value === 'number') {
          onResize({ ...activePlacement, scale: value / 100 });
        }
      }}
      sx={{ width: 180, maxWidth: '50vw' }}
    />
    {activeInkSize !== undefined &&
    onInkSizeChange &&
    thicknessSliderId !== undefined ? (
      <>
        <Typography id={thicknessSliderId}>Grubość</Typography>
        <Slider
          aria-labelledby={thicknessSliderId}
          disabled={committing}
          min={Math.round((MIN_SIGNING_INK_SIZE / DEFAULT_SIGNING_INK_SIZE) * 100)}
          max={Math.round((MAX_SIGNING_INK_SIZE / DEFAULT_SIGNING_INK_SIZE) * 100)}
          value={Math.round((activeInkSize / DEFAULT_SIGNING_INK_SIZE) * 100)}
          valueLabelDisplay="auto"
          valueLabelFormat={(value) => `${value}%`}
          onChange={(_, value) => {
            if (typeof value === 'number') {
              onInkSizeChange((value / 100) * DEFAULT_SIGNING_INK_SIZE);
            }
          }}
          sx={{ width: 180, maxWidth: '50vw' }}
        />
      </>
    ) : null}
    {pageCount !== undefined &&
    pageIndex !== undefined &&
    onPageChange ? (
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
        <Button
          size="small"
          aria-label="Przenieś odcisk na poprzednią stronę"
          disabled={committing || pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
          sx={{ minWidth: 36 }}
        >
          ←
        </Button>
        <Typography variant="body2">
          Strona: {pageIndex + 1} / {pageCount}
        </Typography>
        <Button
          size="small"
          aria-label="Przenieś odcisk na następną stronę"
          disabled={committing || pageIndex === pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
          sx={{ minWidth: 36 }}
        >
          →
        </Button>
      </Stack>
    ) : null}
    <Button
      color="error"
      onClick={onRemove}
      disabled={removeDisabled || committing}
      sx={{ minHeight: 44 }}
    >
      Usuń
    </Button>
    <Typography variant="body2">{label}</Typography>
    {contributorLabel ? (
      <Typography variant="body2" color="text.secondary">
        Podpis: {contributorLabel}
      </Typography>
    ) : null}
  </Stack>
);

export const DocumentSigningPage = ({
  documentId,
  fileId,
}: {
  documentId: string;
  fileId: string;
}) => {
  const navigate = useNavigate();
  const signingSearch = useSearch({ from: '/app/documents/$id/sign/$fileId' });
  const queryClient = useQueryClient();
  const documentQuery = useQuery(actions.document(documentId));
  const sourceQuery = useQuery(actions.documentFile(documentId, fileId));
  const identityQuery = useQuery(actions.me);
  const activeRemotePadSession = useQuery({
    ...actions.activePadSession,
    refetchOnMount: 'always',
  });
  const tenantSettings = useQuery(actions.tenantSettings);
  const sourceUpdateRequest = useQuery(
    actions.activeSourceUpdateRequest(documentId),
  );
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const fitBoxRef = useRef<HTMLDivElement>(null);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const currentStrokeRef = useRef<InkStroke | undefined>(undefined);
  const activePointerRef = useRef<number | undefined>(undefined);
  const activePointerTypeRef = useRef<string | undefined>(undefined);
  const activePenPointerRef = useRef<number | undefined>(undefined);
  const lastPenSeenAtRef = useRef<number | undefined>(undefined);
  const placementDragRef = useRef<
    {
      pointerId: number;
      clientX: number;
      clientY: number;
      placement: SignaturePlacement;
      stampIndex?: number;
    } | undefined
  >(undefined);
  const preventActivePlacementTouchMove = useCallback((event: TouchEvent) => {
    if (placementDragRef.current && event.cancelable) event.preventDefault();
  }, []);
  const setInkCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      inkCanvasRef.current?.removeEventListener(
        'touchmove',
        preventActivePlacementTouchMove,
      );
      inkCanvasRef.current = node;
      node?.addEventListener('touchmove', preventActivePlacementTouchMove, {
        passive: false,
      });
    },
    [preventActivePlacementTouchMove],
  );
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [pdfError, setPdfError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageRendering, setPageRendering] = useState(false);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [metricsPageNumber, setMetricsPageNumber] = useState<number>();
  const [massFitBox, setMassFitBox] = useState<{ width: number; height: number }>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();
  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);
  const [stamps, setStamps] = useState<SigningStamp[]>([]);
  const [selectedStampIndex, setSelectedStampIndex] = useState<number>();
  const [massExitConfirming, setMassExitConfirming] = useState(false);
  const [fingerDrawing, setFingerDrawing] = useState(false);
  const [gestureMode, setGestureMode] = useState<SigningGestureMode>(
    detectDefaultGestureMode,
  );
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [inkColorId, setInkColorId] = useState<SigningInkColorId>(
    DEFAULT_SIGNING_INK_COLOR.id,
  );
  const [commitError, setCommitError] = useState<string>();
  const requestUpload = useMutation(actions.requestFileUpload);
  const directUpload = useMutation(actions.directFileUpload);
  const finalizeUpload = useMutation(actions.finalizeFileUpload);
  const serverUpload = useMutation(actions.uploadDocumentFile);
  const createSignatureRecord = useMutation(actions.createSignatureRecord);
  const createRemotePadSession = useMutation(actions.createPadSession);
  const requestRemotePadSignature = useMutation(actions.requestPadSignature);
  const setRemotePadCurrentDocument = useMutation(actions.setPadCurrentDocument);
  const consumeRemotePadStrokes = useMutation(actions.consumePadStrokes);
  const consumeRemotePadSubmission = useMutation(actions.consumePadSubmission);
  const closeRemotePadSessionMutation = useMutation(actions.closePadSession);
  const [committing, setCommitting] = useState(false);
  const [remotePadQrOpen, setRemotePadQrOpen] = useState(false);
  const [remotePadSession, setRemotePadSession] = useState<RemotePadSession>();
  const [remotePadQrDataUrl, setRemotePadQrDataUrl] = useState<string>();
  const [remotePadError, setRemotePadError] = useState<string>();
  const [autoPad, setAutoPad] = useState(false);
  const [incomingSubmissions, setIncomingSubmissions] = useState<PadQueuedSubmission[]>([]);
  const [trayAnchor, setTrayAnchor] = useState<HTMLElement | null>(null);
  const [trayAdvanceConfirming, setTrayAdvanceConfirming] = useState(false);
  const consumingRemotePadRef = useRef(false);
  const requestingRemotePadRef = useRef(false);
  const syncedRemoteDocumentRef = useRef<string | undefined>(undefined);

  const queueTargets = signingQueueFromSearch(signingSearch);
  const massMode = signingSearch.tryb === 'masowe';
  const massComplete = massMode && signingSearch.koniec === true;
  const massSkippedCount = signingSearch.pominiete ?? 0;
  const massStateValid =
    !massMode ||
    (signingSearch.podpisane !== undefined &&
      signingSearch.pominiete !== undefined &&
      signingSearch.razem !== undefined &&
      signingSearch.razem > 0);
  const sequenceSignedCount = signingSearch.podpisane ?? 0;
  const sequenceTotal = signingSearch.razem ?? 0;
  const listSearch = documentsSearchFromSigningSearch(signingSearch);
  const activeSigningTargetKey = `${documentId}:${fileId}`;
  const activeIncomingSubmissions = incomingSubmissions.filter(
    (submission) => submission.document.key === activeSigningTargetKey,
  );
  const desktopContributor = identityQuery.data
    ? {
        accountId: identityQuery.data.userId,
        label: identityQuery.data.name,
      }
    : undefined;

  const closeRemotePadSession = async () => {
    if (!remotePadSession) return;
    try {
      await closeRemotePadSessionMutation.mutateAsync(remotePadSession.id);
    } catch (error) {
      setRemotePadError(
        error instanceof Error ? error.message : 'Nie udało się zakończyć sesji pada.',
      );
      return;
    }
    setRemotePadSession(undefined);
    setIncomingSubmissions([]);
    setTrayAnchor(null);
    setRemotePadQrDataUrl(undefined);
    setRemotePadQrOpen(false);
    await queryClient.invalidateQueries(actions.activePadSessionInvalidates());
  };

  const close = () => {
    void navigate({
      to: '/app/documents/$id',
      params: { id: documentId },
      search: listSearch,
    });
  };

  useEffect(() => {
    if (massStateValid) return;
    void navigate({
      to: '/app/documents',
      search: listSearch,
      replace: true,
    });
  }, [listSearch, massStateValid, navigate]);

  useEffect(() => {
    const active = activeRemotePadSession.data?.session;
    if (!active) return;
    setRemotePadSession((current) =>
      current?.id === active.id
        ? {
            ...current,
            mode: active.mode,
            lastPolledAt: active.lastPolledAt,
            pendingRequestId:
              current.pendingRequestId ?? active.currentRequest?.requestId ?? null,
          }
        : {
            id: active.id,
            url: padUrlForSession(active.id, ''),
            mode: active.mode,
            lastPolledAt: active.lastPolledAt,
            participants: [],
            pendingRequestId: active.currentRequest?.requestId ?? null,
            pendingTargetKey: null,
            fulfilledTargetKey: null,
          },
    );
  }, [activeRemotePadSession.data?.session]);

  const openRemotePadQr = () => {
    setRemotePadQrOpen(true);
    setRemotePadError(undefined);
    if (remotePadSession || createRemotePadSession.isPending) return;
    void createRemotePadSession
      .mutateAsync('shared')
      .then(({ session, secret }) => {
        const url = padUrlForSession(session.id, secret);
        setRemotePadSession({
          id: session.id,
          url,
          mode: session.mode,
          lastPolledAt: session.lastPolledAt,
          participants: [],
          pendingRequestId: null,
          pendingTargetKey: null,
          fulfilledTargetKey: null,
        });
        void queryClient.invalidateQueries(actions.activePadSessionInvalidates());
      })
      .catch((error: unknown) => {
        setRemotePadError(error instanceof Error ? error.message : 'Nie udało się utworzyć sesji pada.');
      });
  };

  useEffect(() => {
    if (!remotePadSession?.url) {
      setRemotePadQrDataUrl(undefined);
      return;
    }
    let current = true;
    void QRCode.toDataURL(remotePadSession.url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    })
      .then((dataUrl) => {
        if (current) setRemotePadQrDataUrl(dataUrl);
      })
      .catch((error: unknown) => {
        if (current) setRemotePadError(error instanceof Error ? error.message : 'Nie udało się utworzyć kodu QR.');
      });
    return () => {
      current = false;
    };
  }, [remotePadSession?.url]);

  useEffect(() => {
    const sessionId = remotePadSession?.id;
    const documentTitle = documentQuery.data?.document.title;
    if (!sessionId || remotePadSession.mode !== 'shared' || !documentTitle) return;
    const syncKey = `${sessionId}:${activeSigningTargetKey}:${documentTitle}`;
    if (syncedRemoteDocumentRef.current === syncKey) return;
    syncedRemoteDocumentRef.current = syncKey;
    void setRemotePadCurrentDocument
      .mutateAsync({
        sessionId,
        document: { key: activeSigningTargetKey, title: documentTitle },
      })
      .catch((error: unknown) => {
        syncedRemoteDocumentRef.current = undefined;
        setRemotePadError(
          error instanceof Error
            ? error.message
            : 'Nie udało się udostępnić dokumentu padom.',
        );
      });
  }, [
    activeSigningTargetKey,
    documentQuery.data?.document.title,
    remotePadSession?.id,
    remotePadSession?.mode,
    setRemotePadCurrentDocument,
  ]);

  const returnToList = () => {
    setSignaturePadOpen(false);
    void navigate({
      to: '/app/documents',
      search: listSearch,
      replace: true,
    });
  };

  const requestMassExit = () => {
    if (stamps.length > 0 || activeIncomingSubmissions.length > 0) {
      setMassExitConfirming(true);
      return;
    }
    returnToList();
  };

  const sourceFile = documentQuery.data?.document.files.find(
    (file) => file.id === fileId,
  );
  const signable = sourceFile ? canSignPdfFile(sourceFile) : false;
  const previouslySignedSource = sourceFile
    ? signedDigitalSourceHint(sourceFile)
    : false;
  const inkColor = signingInkColorById(inkColorId);
  const pageIndex = pageNumber - 1;
  const selectedStamp =
    selectedStampIndex === undefined ? undefined : stamps[selectedStampIndex];
  const activePlacement = selectedStamp?.placement ?? placement;
  const activeInkSize = selectedStamp?.inkSize ?? DEFAULT_SIGNING_INK_SIZE;
  const stampTouchActionLocked =
    placing ||
    signingStampsForPage(stamps, pageIndex).length > 0;
  const pageReady = Boolean(
    metrics && metricsPageNumber === pageNumber && !pageRendering,
  );
  const canCommit = Boolean(
    pageReady &&
      (massMode
        ? stamps.length > 0
        : stamps.length > 0 || (strokes.length > 0 && desktopContributor)),
  );
  const signingPadBlocked = !pageReady || committing;
  const signingPadBusy = !committing && !pageReady;
  const massProceedBlockedByReadiness = stamps.length > 0 && !canCommit;
  const massProceedBusy = committing || massProceedBlockedByReadiness;

  useEffect(() => {
    setPdf(undefined);
    setPdfError(undefined);
    setPageNumber(1);
    setPageRendering(false);
    setMetrics(undefined);
    setMetricsPageNumber(undefined);
    setMassFitBox(undefined);
    setStrokes([]);
    setActiveStroke(undefined);
    setPlacing(false);
    setPlacement(DEFAULT_PLACEMENT);
    setStamps([]);
    setSelectedStampIndex(undefined);
    setMassExitConfirming(false);
    setTrayAdvanceConfirming(false);
    setTrayAnchor(null);
    setSignaturePadOpen(false);
    setCommitError(undefined);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    activePenPointerRef.current = undefined;
    lastPenSeenAtRef.current = undefined;
    placementDragRef.current = undefined;
  }, [documentId, fileId]);

  useEffect(() => {
    if (!sourceQuery.data || !signable) return;
    let current = true;
    let loaded: LoadedPdf | undefined;
    setPdfError(undefined);
    void loadSourcePdf(sourceQuery.data.bytes)
      .then((document) => {
        loaded = document;
        if (current) {
          setPdf(document);
          setPageNumber(massMode ? document.numPages : 1);
        } else {
          void document.destroy();
        }
      })
      .catch((error: unknown) => {
        if (current) setPdfError(`Nie udało się otworzyć pliku PDF: ${String(error)}`);
      });
    return () => {
      current = false;
      if (loaded) void loaded.destroy();
    };
  }, [massMode, signable, sourceQuery.data]);

  useEffect(() => {
    if (!massMode) {
      setMassFitBox(undefined);
      return;
    }
    if (!pdf) return;
    const element = fitBoxRef.current;
    if (!element) return;
    const updateFitBox = () => {
      const bounds = element.getBoundingClientRect();
      const next = {
        width: bounds.width > 0 ? Math.floor(bounds.width) : 0,
        height: bounds.height > 0 ? Math.floor(bounds.height) : 0,
      };
      if (next.width === 0 || next.height === 0) return;
      setMassFitBox((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    updateFitBox();
    const animationFrame = window.requestAnimationFrame(updateFitBox);
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateFitBox);
      window.addEventListener('orientationchange', updateFitBox);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', updateFitBox);
        window.removeEventListener('orientationchange', updateFitBox);
      };
    }
    const observer = new ResizeObserver(updateFitBox);
    observer.observe(element);
    window.addEventListener('resize', updateFitBox);
    window.addEventListener('orientationchange', updateFitBox);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', updateFitBox);
      window.removeEventListener('orientationchange', updateFitBox);
    };
  }, [massMode, pdf]);

  useEffect(() => {
    const pdfCanvas = pdfCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!pdf || !pdfCanvas || !inkCanvas) return;
    if (massMode && !massFitBox) return;
    let current = true;
    const renderJob = renderChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (!current) return;
        setPageRendering(true);
        setMetrics(undefined);
        setMetricsPageNumber(undefined);
        try {
          const renderedMetrics = await renderSourcePage(
            pdf,
            pageNumber,
            pdfCanvas,
            massMode ? massFitBox : undefined,
          );
          if (!current) return;
          inkCanvas.width = pdfCanvas.width;
          inkCanvas.height = pdfCanvas.height;
          setMetrics(renderedMetrics);
          setMetricsPageNumber(pageNumber);
          setPageRendering(false);
        } catch (error: unknown) {
          if (!current) return;
          setPdfError(`Nie udało się wyświetlić strony: ${String(error)}`);
          setPageRendering(false);
        }
      });
    renderChainRef.current = renderJob.then(
      () => undefined,
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [massFitBox, massMode, pageNumber, pdf]);

  useEffect(() => {
    const canvas = inkCanvasRef.current;
    if (!canvas || !metrics) return;
    const currentPageStamps = signingStampsForPage(stamps, pageIndex);
    drawInk(
      canvas,
      [
        ...currentPageStamps.map(({ stamp, stampIndex }) => ({
          strokes: stamp.strokes,
          placement: stamp.placement,
          color: stamp.inkColor.canvasColor,
          selected: selectedStampIndex === stampIndex,
          ...(stamp.inkSize === undefined ? {} : { inkSize: stamp.inkSize }),
        })),
        ...(strokes.length || activeStroke
          ? [
              {
                strokes: activeStroke ? [...strokes, activeStroke] : strokes,
                placement,
                color: inkColor.canvasColor,
                selected: selectedStampIndex === undefined && placing,
              },
            ]
          : []),
      ],
      metrics,
    );
  }, [
    activeStroke,
    inkColor.canvasColor,
    metrics,
    pageIndex,
    placing,
    placement,
    selectedStampIndex,
    stamps,
    strokes,
  ]);

  useEffect(() => {
    if (
      selectedStampIndex !== undefined &&
      stamps[selectedStampIndex]?.pageIndex !== pageIndex
    ) {
      setSelectedStampIndex(undefined);
    }
  }, [pageIndex, selectedStampIndex, stamps]);

  useEffect(() => {
    if (stamps.length === 0) setMassExitConfirming(false);
  }, [stamps.length]);

  const materializePadStrokes = useCallback(
    (
      padStrokes: InkStroke[],
      sourceSize: { width: number; height: number },
      contributedBy: SigningStamp['contributedBy'],
      remoteInkColorId: SigningInkColorId = inkColorId,
    ): boolean => {
      if (!pageReady || !metrics || !padStrokes.length) return false;
      const padInkColor = signingInkColorById(remoteInkColorId);
      const fittedStrokes = fitInkStrokesToPage({
        strokes: padStrokes,
        sourceSize,
        pageSize: { width: metrics.cssWidth, height: metrics.cssHeight },
      });
      const stamp = createSigningStamp({
        pageIndex,
        strokes: fittedStrokes,
        placement: defaultSignaturePlacement({
          previouslySignedSource,
          strokes: fittedStrokes,
        }),
        inkColor: padInkColor,
        contributedBy,
      });
      setInkColorId(remoteInkColorId);
      setStamps((current) => {
        const next = appendSigningStamp(current, stamp);
        setSelectedStampIndex(next.length - 1);
        return next;
      });
      setPlacing(true);
      return true;
    },
    [inkColorId, metrics, pageIndex, pageReady, previouslySignedSource],
  );

  const removeIncomingSubmission = (submissionId: string) => {
    setIncomingSubmissions((current) =>
      current.filter((submission) => submission.id !== submissionId),
    );
  };

  const discardIncomingSubmission = async (submission: PadQueuedSubmission) => {
    const sessionId = remotePadSession?.id;
    if (!sessionId) return;
    try {
      await consumeRemotePadSubmission.mutateAsync({
        sessionId,
        submissionId: submission.id,
      });
      removeIncomingSubmission(submission.id);
      setTrayAnchor(null);
    } catch (error) {
      setRemotePadError(
        error instanceof Error ? error.message : 'Nie udało się odrzucić podpisu.',
      );
    }
  };

  const materializeIncomingSubmission = async (
    submission: PadQueuedSubmission,
  ) => {
    const sessionId = remotePadSession?.id;
    if (!sessionId || submission.document.key !== activeSigningTargetKey) return;
    if (!pageReady) {
      setRemotePadError('Poczekaj na wyrenderowanie strony przed umieszczeniem podpisu.');
      return;
    }
    try {
      const consumed = await consumeRemotePadSubmission.mutateAsync({
        sessionId,
        submissionId: submission.id,
      });
      const materialized = materializePadStrokes(
        remoteStrokesToInkStrokes(consumed.submission.strokes),
        consumed.submission.sourceSize,
        consumed.submission.contributedBy,
        consumed.submission.inkColor,
      );
      if (!materialized) return;
      removeIncomingSubmission(submission.id);
      setTrayAnchor(null);
    } catch (error) {
      setRemotePadError(
        error instanceof Error ? error.message : 'Nie udało się umieścić podpisu.',
      );
    }
  };

  const discardActiveIncomingSubmissions = async () => {
    await Promise.all(
      activeIncomingSubmissions.map((submission) =>
        discardIncomingSubmission(submission),
      ),
    );
  };

  const requestSignatureFromRemotePad = useCallback(async () => {
    const sessionId = remotePadSession?.id;
    const documentTitle = documentQuery.data?.document.title;
    if (!sessionId || !documentTitle || requestingRemotePadRef.current) return;
    requestingRemotePadRef.current = true;
    setRemotePadError(undefined);
    try {
      const { request } = await requestRemotePadSignature.mutateAsync({
        sessionId,
        input: { documentTitle },
      });
      setRemotePadSession((current) =>
        current?.id === sessionId
          ? {
              ...current,
              pendingRequestId: request.requestId,
              pendingTargetKey: activeSigningTargetKey,
            }
          : current,
      );
    } catch (error) {
      setRemotePadError(
        error instanceof Error
          ? error.message
          : 'Nie udało się poprosić pada o podpis.',
      );
    } finally {
      requestingRemotePadRef.current = false;
    }
  }, [
    activeSigningTargetKey,
    documentQuery.data?.document.title,
    remotePadSession?.id,
    requestRemotePadSignature,
  ]);

  const isRemotePadConnected = remotePadConnected(
    remotePadSession?.mode === 'shared'
      ? null
      : remotePadSession?.lastPolledAt ?? null,
  );
  const isSharedRemotePadConnected =
    remotePadSession?.mode === 'shared' &&
    sharedPadConnected(remotePadSession.participants);
  const hasConnectedRemotePad = isRemotePadConnected || isSharedRemotePadConnected;

  useEffect(() => {
    const sessionId = remotePadSession?.id;
    if (!sessionId) return;
    const interval = window.setInterval(() => {
      if (consumingRemotePadRef.current) return;
      consumingRemotePadRef.current = true;
      void consumeRemotePadStrokes
        .mutateAsync(sessionId)
        .then(({ lastPolledAt, participants, submissions, submittedStrokes }) => {
          setRemotePadSession((current) =>
            current?.id === sessionId
              ? { ...current, lastPolledAt, participants }
              : current,
          );
          setIncomingSubmissions(submissions);
          const requestedSubmission = submissions.find(
            (submission) =>
              submission.requestId !== null &&
              submission.requestId === remotePadSession.pendingRequestId,
          );
          if (requestedSubmission) {
            setRemotePadSession((current) =>
              current?.id === sessionId
                ? {
                    ...current,
                    pendingRequestId: null,
                    pendingTargetKey: null,
                    fulfilledTargetKey:
                      current.pendingTargetKey ?? activeSigningTargetKey,
                  }
                : current,
            );
          }
          if (!submittedStrokes) return;
          if (submittedStrokes.requestId !== remotePadSession.pendingRequestId) return;
          const materialized = materializePadStrokes(
            remoteStrokesToInkStrokes(submittedStrokes.strokes),
            submittedStrokes.sourceSize,
            submittedStrokes.contributedBy,
            submittedStrokes.inkColor,
          );
          if (!materialized) return;
          setRemotePadSession((current) =>
            current?.id === sessionId
              ? {
                  ...current,
                  pendingRequestId: null,
                  pendingTargetKey: null,
                  fulfilledTargetKey:
                    current.pendingTargetKey ?? activeSigningTargetKey,
                }
              : current,
          );
        })
        .catch((error: unknown) => {
          setRemotePadError(error instanceof Error ? error.message : 'Nie udało się odebrać podpisu z pada.');
        })
        .finally(() => {
          consumingRemotePadRef.current = false;
        });
    }, REMOTE_PAD_POLL_MS);
    return () => window.clearInterval(interval);
  }, [
    consumeRemotePadStrokes,
    activeSigningTargetKey,
    materializePadStrokes,
    remotePadSession?.id,
    remotePadSession?.pendingRequestId,
  ]);

  useEffect(() => {
    if (
      !massMode ||
      !autoPad ||
      !pageReady ||
      !hasConnectedRemotePad ||
      !remotePadSession ||
      (remotePadSession.pendingRequestId !== null &&
        (remotePadSession.pendingTargetKey === null ||
          remotePadSession.pendingTargetKey === activeSigningTargetKey)) ||
      remotePadSession.fulfilledTargetKey === activeSigningTargetKey ||
      requestRemotePadSignature.isPending
    ) {
      return;
    }
    void requestSignatureFromRemotePad();
  }, [
    activeSigningTargetKey,
    autoPad,
    hasConnectedRemotePad,
    massMode,
    pageReady,
    remotePadSession,
    requestRemotePadSignature.isPending,
    requestSignatureFromRemotePad,
  ]);

  if (massComplete) {
    return (
      <MassSummary
        signedCount={sequenceSignedCount}
        skippedCount={massSkippedCount}
        onReturn={returnToList}
      />
    );
  }

  if (!massStateValid) {
    return (
      <SigningShell
        header={<EmptyControls />}
        controls={<EmptyControls />}
        footer={<EmptyControls />}
        fitMain
      >
        <StatusView state={{ kind: 'loading', label: 'Powrót do listy…' }} />
      </SigningShell>
    );
  }

  if (
    documentQuery.isPending ||
    sourceQuery.isPending ||
    sourceUpdateRequest.isPending
  ) {
    return (
      <SigningShell
        header={<PageHeader fileName="PDF" onClose={close} />}
        controls={<EmptyControls />}
        footer={<EmptyControls />}
      >
        <StatusView state={{ kind: 'loading', label: 'Otwieranie dokumentu…' }} />
      </SigningShell>
    );
  }

  if (documentQuery.isError || sourceQuery.isError || sourceUpdateRequest.isError) {
    return (
      <SigningShell
        header={<PageHeader fileName="PDF" onClose={close} />}
        controls={<EmptyControls />}
        footer={<EmptyControls />}
      >
        <StatusView
          state={{
            kind: 'error',
            message:
              documentQuery.error?.message ??
              sourceQuery.error?.message ??
              sourceUpdateRequest.error?.message ??
              'Nie udało się pobrać dokumentu.',
          }}
        />
      </SigningShell>
    );
  }

  if (sourceUpdateRequest.data.request) {
    return (
      <SigningShell
        header={<PageHeader fileName={sourceFile?.fileName ?? 'PDF'} onClose={close} />}
        controls={<EmptyControls />}
        footer={<EmptyControls />}
      >
        <Box sx={{ width: '100%', maxWidth: 720, mx: 'auto', p: 3 }}>
          <Alert severity="warning">
            Podpisywanie jest zablokowane, ponieważ trwa aktualizacja źródła tego dokumentu.
          </Alert>
          <Button sx={{ mt: 2 }} variant="contained" onClick={close}>
            Wróć do dokumentu
          </Button>
        </Box>
      </SigningShell>
    );
  }

  if (!sourceFile || !signable) {
    return (
      <SigningShell
        header={<PageHeader fileName="PDF" onClose={close} />}
        controls={<EmptyControls />}
        footer={<EmptyControls />}
      >
        <StatusView
          state={{
            kind: 'error',
            message:
              'Do podpisania można wybrać tylko źródłowy albo podpisany cyfrowo plik PDF.',
          }}
        />
      </SigningShell>
    );
  }

  const pointerPoints = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    pointerEventToInkPoints(
      event.nativeEvent,
      event.currentTarget.getBoundingClientRect(),
    );
  const touchIgnoredForPenPriority = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) =>
    event.pointerType === 'touch' &&
    penPriorityActive({
      activePenPointerId: activePenPointerRef.current,
      lastPenSeenAt: lastPenSeenAtRef.current,
      now: event.timeStamp,
    });

  const cancelActiveTouchStroke = () => {
    if (activePointerTypeRef.current !== 'touch') return;
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    setActiveStroke(undefined);
  };

  const eventDrawsInk = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    pointerDrawsInk({
      fingerDrawing,
      mode: gestureMode,
      penPriority: touchIgnoredForPenPriority(event),
      pointer: { pointerType: event.pointerType },
    });

  const pointerStartsPlacementDrag = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) =>
    event.pointerType !== 'touch' ||
    fingerDrawing ||
    !isPalmSizedTouch({
      height: event.height,
      pointerType: event.pointerType,
      width: event.width,
    });

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    releasePointerCapture(event.currentTarget, event.pointerId);
    if (activePenPointerRef.current === event.pointerId) {
      activePenPointerRef.current = undefined;
      lastPenSeenAtRef.current = event.timeStamp;
    }
    if (placementDragRef.current?.pointerId === event.pointerId) {
      placementDragRef.current = undefined;
      return;
    }
    if (activePointerRef.current !== event.pointerId) return;
    const stroke = currentStrokeRef.current;
    if (stroke?.points.length) setStrokes((current) => [...current, stroke]);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    activePointerTypeRef.current = undefined;
    setActiveStroke(undefined);
  };

  const defaultPlacementFor = (stampStrokes: InkStroke[]) =>
    defaultSignaturePlacement({
      previouslySignedSource,
      strokes: stampStrokes,
    });

  const draftStamp = (targetPageIndex: number) => {
    if (!desktopContributor) return undefined;
    return createSigningStamp({
      pageIndex: targetPageIndex,
      strokes,
      placement,
      inkColor,
      contributedBy: desktopContributor,
    });
  };

  const stampCurrentPage = () => {
    if (!pageReady || !strokes.length || !desktopContributor) return;
    const next = appendSigningStamp(
      stamps,
      createSigningStamp({
        pageIndex,
        strokes,
        placement: defaultPlacementFor(strokes),
        inkColor,
        contributedBy: desktopContributor,
      }),
    );
    setStamps(next);
    setSelectedStampIndex(next.length - 1);
    setPlacing(true);
  };

  const useSignaturePad = (
    padStrokes: InkStroke[],
    sourceSize: { width: number; height: number },
  ) => {
    if (
      desktopContributor &&
      materializePadStrokes(padStrokes, sourceSize, desktopContributor)
    ) {
      setSignaturePadOpen(false);
    }
  };

  const stampAllPages = () => {
    if (!pageReady || !strokes.length || !pdf || !desktopContributor) return;
    const next = stampEveryPage(
      stamps,
      {
        strokes,
        placement: defaultPlacementFor(strokes),
        inkColor,
        contributedBy: desktopContributor,
      },
      pdf.numPages,
    );
    setStamps(next);
    setSelectedStampIndex(next.length - pdf.numPages + pageIndex);
    setPlacing(true);
  };

  const removeSelectedStamp = () => {
    if (selectedStampIndex === undefined) return;
    setStamps(removeSigningStamp(stamps, selectedStampIndex));
    setSelectedStampIndex(undefined);
  };

  const moveSelectedStampPage = (targetPageIndex: number) => {
    if (selectedStampIndex === undefined || !pdf) return;
    const nextPageIndex = Math.min(
      pdf.numPages - 1,
      Math.max(0, targetPageIndex),
    );
    setStamps(
      moveSigningStampToPage(
        stamps,
        selectedStampIndex,
        nextPageIndex,
        pdf.numPages,
      ),
    );
    setPageNumber(nextPageIndex + 1);
  };

  const resizeActivePlacement = (next: SignaturePlacement) => {
    if (selectedStampIndex === undefined) {
      setPlacement(clampSignaturePlacementToPage(strokes, next));
      return;
    }
    setStamps(updateSigningStampPlacement(stamps, selectedStampIndex, next));
  };

  const resizeSelectedInk = (inkSize: number) => {
    if (selectedStampIndex === undefined) return;
    setStamps((current) =>
      current.map((stamp, index) =>
        index === selectedStampIndex
          ? createSigningStamp({ ...stamp, inkSize })
          : createSigningStamp(stamp),
      ),
    );
  };

  const flattenedStamps = async (): Promise<
    Parameters<typeof flattenSignedPdf>[1]
  > => {
    if (!pdf || !metrics) return [];
    const canvas = inkCanvasRef.current;
    const bounds = canvas?.getBoundingClientRect();
    const currentMetrics =
      bounds && bounds.width > 0 && bounds.height > 0
        ? { ...metrics, cssWidth: bounds.width, cssHeight: bounds.height }
        : metrics;
    const draft = draftStamp(pageIndex);
    const committedStamps = stamps.length > 0 ? stamps : draft ? [draft] : [];
    return Promise.all(
      committedStamps.map(async (stamp) => ({
        stamp,
        metrics:
          stamp.pageIndex === pageIndex
            ? currentMetrics
            : await sourcePageMetrics(pdf, stamp.pageIndex + 1),
      })),
    );
  };

  const advanceMassSigning = ({
    signedCount,
    skippedCount,
  }: {
    signedCount: number;
    skippedCount: number;
  }) => {
    const [next, ...remaining] = queueTargets;
    if (next) {
      void navigate({
        to: '/app/documents/$id/sign/$fileId',
        params: { id: next.documentId, fileId: next.fileId },
        search: {
          ...listSearch,
          ...massSigningQueueSearch({
            signedCount,
            skippedCount,
            targets: remaining,
            total: sequenceTotal,
          }),
        },
        replace: true,
      });
      return;
    }
    void navigate({
      to: '/app/documents/$id/sign/$fileId',
      params: { id: documentId, fileId },
      search: {
        ...listSearch,
        tryb: 'masowe',
        koniec: true,
        podpisane: signedCount,
        pominiete: skippedCount,
        razem: sequenceTotal,
      },
      replace: true,
    });
  };

  const saveSignedPdf = async () => {
    const settings = tenantSettings.data ??
      await queryClient.fetchQuery(actions.tenantSettings);
    const currentDocument: DocumentWithFiles | undefined = documentQuery.data?.document;
    if (!currentDocument) throw new Error('Nie udało się odczytać danych dokumentu.');
    const committedStamps = await flattenedStamps();
    const signedBytes = await flattenSignedPdf(
      sourceQuery.data.bytes,
      committedStamps,
    );
    const output = new File(
      [bytesAsArrayBuffer(signedBytes)],
      signedFileName(sourceFile.fileName),
      { type: 'application/pdf' },
    );
    const uploadedFile = await uploadDocumentFile(output, 'signed-digital', {
      request: (input) =>
        requestUpload.mutateAsync({ documentId, input }),
      direct: (input) => directUpload.mutateAsync(input),
      finalize: (input) =>
        finalizeUpload.mutateAsync({ documentId, input }),
      server: (input) =>
        serverUpload.mutateAsync({ documentId, input }),
    }, committedStamps.map(({ stamp }) => stamp.contributedBy.accountId));
    const persistSignatureRecord = async () => {
      try {
        const warning = await storeSignatureRecordAfterUpload({
          create: (input) => createSignatureRecord.mutateAsync(input),
          documentId,
          fileId: uploadedFile.id,
          stamps: committedStamps.map(({ stamp }) => stamp),
          storeSignatureRecords: settings.settings.storeSignatureRecords,
        });
        await queryClient.invalidateQueries(
          actions.signatureRecordsInvalidates(documentId),
        );
        if (warning) appNoticeStore.show(warning);
      } catch {
        appNoticeStore.show(
          'Podpisany PDF zapisano, ale nie udało się sprawdzić ustawienia zapisu podpisów.',
        );
      }
    };
    void persistSignatureRecord();
    await queryClient.invalidateQueries(actions.documentsInvalidates());
  };

  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setCommitError(undefined);
    try {
      await saveSignedPdf();
      await navigate({
        to: '/app/documents/$id',
        params: { id: documentId },
        search: listSearch,
        replace: true,
      });
    } catch (error) {
      setCommitError(uploadErrorMessage(error));
    } finally {
      setCommitting(false);
    }
  };

  const proceedMassSigning = async (trayConfirmed = false) => {
    if (committing) return;
    if (activeIncomingSubmissions.length > 0 && !trayConfirmed) {
      setTrayAdvanceConfirming(true);
      return;
    }
    if (stamps.length === 0) {
      advanceMassSigning({
        signedCount: sequenceSignedCount,
        skippedCount: massSkippedCount + 1,
      });
      return;
    }
    if (!canCommit) return;
    setCommitting(true);
    setCommitError(undefined);
    try {
      await saveSignedPdf();
      advanceMassSigning({
        signedCount: sequenceSignedCount + 1,
        skippedCount: massSkippedCount,
      });
    } catch (error) {
      setCommitError(uploadErrorMessage(error));
    } finally {
      setCommitting(false);
    }
  };

  const discardTrayAndProceed = async () => {
    await discardActiveIncomingSubmissions();
    setTrayAdvanceConfirming(false);
    await proceedMassSigning(true);
  };

  const incomingTray = (
    <IncomingSignatureTray
      anchor={trayAnchor}
      submissions={activeIncomingSubmissions}
      onClose={() => setTrayAnchor(null)}
      onOpen={setTrayAnchor}
      onDiscard={(submission) => void discardIncomingSubmission(submission)}
      onMaterialize={(submission) => void materializeIncomingSubmission(submission)}
    />
  );

  return (
    <SigningShell
      header={
        massMode ? (
          <MassReviewHeader
            document={documentQuery.data.document}
            onClose={requestMassExit}
          />
        ) : (
          <PageHeader fileName={sourceFile.fileName} onClose={close} />
        )
      }
      controls={
        massMode ? (
          pdf && pdf.numPages > 1 ? (
            <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 0.75 }}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}
              >
                <Button
                  size="small"
                  onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
                  disabled={pageNumber === 1 || pageRendering || committing}
                >
                  Poprzednia
                </Button>
                <Typography variant="body2" aria-live="polite">
                  Strona {pageNumber} z {pdf.numPages}
                </Typography>
                <Button
                  size="small"
                  onClick={() =>
                    setPageNumber((page) => Math.min(pdf.numPages, page + 1))
                  }
                  disabled={pageNumber === pdf.numPages || pageRendering || committing}
                >
                  Następna
                </Button>
              </Stack>
            </Paper>
          ) : (
            <EmptyControls />
          )
        ) : (
          <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1 }}>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 1,
                flexWrap: 'wrap',
                touchAction: 'manipulation',
              }}
            >
              <Button
                onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
                disabled={pageNumber === 1 || pageRendering}
                sx={buttonTouchSx}
              >
                ← Poprzednia
              </Button>
              <Typography aria-live="polite">
                Strona {pageNumber} z {pdf?.numPages ?? '…'}
              </Typography>
              <Button
                onClick={() =>
                  setPageNumber((page) => Math.min(pdf?.numPages ?? page, page + 1))
                }
                disabled={!pdf || pageNumber === pdf.numPages || pageRendering}
                sx={buttonTouchSx}
              >
                Następna →
              </Button>
              <Button
                variant="contained"
                onClick={() => setSignaturePadOpen(true)}
                disabled={signingPadBlocked}
                startIcon={signingPadBusy ? <BusyButtonProgress /> : undefined}
                sx={buttonTouchSx}
              >
                {signingPadBusy ? 'Renderowanie…' : 'Złóż podpis'}
              </Button>
              {!hasConnectedRemotePad ? (
                <Button
                  variant="outlined"
                  onClick={openRemotePadQr}
                  disabled={
                    committing ||
                    createRemotePadSession.isPending ||
                    activeRemotePadSession.isPending
                  }
                  startIcon={createRemotePadSession.isPending ? <BusyButtonProgress /> : undefined}
                  sx={buttonTouchSx}
                >
                  Pad QR
                </Button>
              ) : null}
              {remotePadSession ? (
                <>
                  <Button
                    variant="outlined"
                    onClick={() => void requestSignatureFromRemotePad()}
                    disabled={
                      signingPadBlocked ||
                      requestRemotePadSignature.isPending ||
                      remotePadSession.pendingRequestId !== null
                    }
                    startIcon={requestRemotePadSignature.isPending ? <BusyButtonProgress /> : undefined}
                    sx={buttonTouchSx}
                  >
                    Poproś pad o podpis
                  </Button>
                  <RemotePadStatusIndicator
                    connected={hasConnectedRemotePad}
                    onOpen={openRemotePadQr}
                  />
                </>
              ) : null}
              {incomingTray}
              <ToggleButtonGroup
                exclusive
                size="small"
                value={gestureMode}
                onChange={(_, selected: SigningGestureMode | null) => {
                  if (selected) setGestureMode(selected);
                }}
                aria-label="Tryb gestów"
              >
                <ToggleButton value="draw" disabled={committing} aria-label="Rysuj">
                  Rysuj
                </ToggleButton>
                <ToggleButton value="pan" disabled={committing} aria-label="Przesuń">
                  Przesuń
                </ToggleButton>
              </ToggleButtonGroup>
              <Button
                onClick={() => setStrokes((current) => current.slice(0, -1))}
                disabled={!strokes.length || committing}
                sx={buttonTouchSx}
              >
                Cofnij kreskę
              </Button>
              <Button
                onClick={() => {
                  setStrokes([]);
                  setPlacing(false);
                  setPlacement(DEFAULT_PLACEMENT);
                  setSelectedStampIndex(undefined);
                  currentStrokeRef.current = undefined;
                  activePointerRef.current = undefined;
                  activePointerTypeRef.current = undefined;
                }}
                disabled={!strokes.length || committing}
                sx={buttonTouchSx}
              >
                Wyczyść
              </Button>
              <Button
                variant={placing ? 'contained' : 'outlined'}
                onClick={() => setPlacing((current) => !current)}
                disabled={
                  (!strokes.length && selectedStampIndex === undefined) || committing
                }
                sx={buttonTouchSx}
              >
                {placing ? 'Wróć do rysowania' : 'Ustaw położenie'}
              </Button>
              <Button
                variant="contained"
                onClick={stampCurrentPage}
                disabled={!pageReady || !strokes.length || committing}
                sx={buttonTouchSx}
              >
                Przybij na tej stronie
              </Button>
              <Button
                variant="contained"
                onClick={stampAllPages}
                disabled={!pageReady || !strokes.length || !pdf || committing}
                sx={buttonTouchSx}
              >
                Przybij na każdej stronie
              </Button>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={inkColorId}
                onChange={(_, selected: SigningInkColorId | null) => {
                  if (selected) setInkColorId(selected);
                }}
                aria-label="Kolor tuszu"
              >
                {SIGNING_INK_COLORS.map((color) => (
                  <ToggleButton
                    key={color.id}
                    value={color.id}
                    disabled={committing}
                    aria-label={color.label}
                  >
                    {color.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <ToggleButton
                value="finger-drawing"
                selected={fingerDrawing}
                onChange={() => setFingerDrawing((current) => !current)}
                disabled={committing}
                aria-label="Rysowanie palcem"
              >
                Rysowanie palcem
              </ToggleButton>
            </Stack>
            {placing ? (
              <StampPlacementControls
                {...(selectedStamp ? { activeInkSize } : {})}
                activePlacement={activePlacement}
                committing={committing}
                label={
                  selectedStamp
                    ? `Wybrany odcisk: strona ${selectedStamp.pageIndex + 1}`
                    : 'Położenie bieżącego rysunku'
                }
                marginTop={1}
                onRemove={removeSelectedStamp}
                {...(selectedStamp
                  ? {
                      contributorLabel: selectedStamp.contributedBy.label,
                      onInkSizeChange: resizeSelectedInk,
                      onPageChange: moveSelectedStampPage,
                      pageCount: pdf
                        ? pdf.numPages
                        : selectedStamp.pageIndex + 1,
                      pageIndex: selectedStamp.pageIndex,
                      thicknessSliderId: 'signature-thickness',
                    }
                  : {})}
                onResize={resizeActivePlacement}
                removeDisabled={selectedStampIndex === undefined}
                sliderId="signature-size"
              />
            ) : (
              <Typography variant="body2" sx={{ mt: 1 }}>
                Odciski w sesji: {stamps.length}
              </Typography>
            )}
          </Paper>
        )
      }
      footer={
        massMode ? (
          <Paper
            square
            sx={{ px: { xs: 1.5, md: 3 }, py: 1.5, touchAction: 'manipulation' }}
          >
            {commitError ? <Alert severity="error" sx={{ mb: 1 }}>{commitError}</Alert> : null}
            {massExitConfirming ? (
              <Alert
                severity="warning"
                sx={{ mb: 1 }}
                action={
                  <Stack direction="row" sx={{ gap: 1 }}>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => setMassExitConfirming(false)}
                    >
                      Wróć
                    </Button>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => {
                        void discardActiveIncomingSubmissions().then(returnToList);
                      }}
                    >
                      Odrzuć i zamknij
                    </Button>
                  </Stack>
                }
              >
                <span>Ten dokument ma niezapisane odciski.</span>
                {activeIncomingSubmissions.length > 0 ? (
                  <Typography component="span" variant="body2" sx={{ display: 'block' }}>
                    W skrzynce są też nieumieszczone podpisy.
                  </Typography>
                ) : null}
              </Alert>
            ) : null}
            {trayAdvanceConfirming ? (
              <Alert
                severity="warning"
                sx={{ mb: 1 }}
                action={
                  <Stack direction="row" sx={{ gap: 1 }}>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => setTrayAdvanceConfirming(false)}
                    >
                      Wróć
                    </Button>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => void discardTrayAndProceed()}
                    >
                      Odrzuć i przejdź dalej
                    </Button>
                  </Stack>
                }
              >
                W skrzynce są nieumieszczone podpisy dla tego dokumentu.
              </Alert>
            ) : null}
            {selectedStamp ? (
              <StampPlacementControls
                activeInkSize={activeInkSize}
                activePlacement={activePlacement}
                committing={committing}
                contributorLabel={selectedStamp.contributedBy.label}
                label={`Wybrany odcisk: strona ${selectedStamp.pageIndex + 1}`}
                marginBottom={1}
                onInkSizeChange={resizeSelectedInk}
                onPageChange={moveSelectedStampPage}
                onRemove={removeSelectedStamp}
                onResize={resizeActivePlacement}
                pageCount={pdf ? pdf.numPages : selectedStamp.pageIndex + 1}
                pageIndex={selectedStamp.pageIndex}
                removeDisabled={selectedStampIndex === undefined}
                sliderId="mass-signature-size"
                thicknessSliderId="mass-signature-thickness"
              />
            ) : null}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', gap: 1.5 }}
            >
              <Typography variant="body2" color="text.secondary">
                Dokument {Math.min(sequenceSignedCount + massSkippedCount + 1, sequenceTotal)} z {sequenceTotal}
              </Typography>
              <Stack
                direction="row"
                sx={{ justifyContent: 'flex-end', gap: 1, touchAction: 'manipulation' }}
              >
                <Button
                  variant="contained"
                  onClick={() => setSignaturePadOpen(true)}
                  disabled={signingPadBlocked}
                  startIcon={signingPadBusy ? <BusyButtonProgress /> : undefined}
                  sx={buttonTouchSx}
                >
                  {signingPadBusy ? 'Renderowanie…' : 'Złóż podpis'}
                </Button>
                {!hasConnectedRemotePad ? (
                  <Button
                    variant="outlined"
                    onClick={openRemotePadQr}
                    disabled={
                      committing ||
                      createRemotePadSession.isPending ||
                      activeRemotePadSession.isPending
                    }
                    startIcon={createRemotePadSession.isPending ? <BusyButtonProgress /> : undefined}
                    sx={buttonTouchSx}
                  >
                    Pad QR
                  </Button>
                ) : null}
                {remotePadSession ? (
                  <Button
                    variant="outlined"
                    onClick={() => void requestSignatureFromRemotePad()}
                    disabled={
                      signingPadBlocked ||
                      requestRemotePadSignature.isPending ||
                      remotePadSession.pendingRequestId !== null
                    }
                    startIcon={requestRemotePadSignature.isPending ? <BusyButtonProgress /> : undefined}
                    sx={buttonTouchSx}
                  >
                    Poproś pad o podpis
                  </Button>
                ) : null}
                {hasConnectedRemotePad ? (
                  <ToggleButton
                    value="auto-pad"
                    selected={autoPad}
                    onChange={() => setAutoPad((current) => !current)}
                    disabled={committing}
                    aria-label="Automatycznie proś pad o podpis"
                    sx={buttonTouchSx}
                  >
                    Auto-pad
                  </ToggleButton>
                ) : null}
                {remotePadSession ? (
                  <RemotePadStatusIndicator
                    connected={hasConnectedRemotePad}
                    onOpen={openRemotePadQr}
                  />
                ) : null}
                {incomingTray}
                <Button
                  variant="contained"
                  onClick={() => void proceedMassSigning()}
                  disabled={massProceedBusy}
                  startIcon={massProceedBusy ? <BusyButtonProgress /> : undefined}
                  sx={buttonTouchSx}
                >
                  {committing
                    ? 'Zapisywanie…'
                    : massProceedBlockedByReadiness
                      ? 'Renderowanie…'
                      : 'Dalej'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ) : (
          <Paper
            square
            sx={{ px: { xs: 1.5, md: 3 }, py: 1.5, touchAction: 'manipulation' }}
          >
            {commitError ? <Alert severity="error" sx={{ mb: 1 }}>{commitError}</Alert> : null}
            <Stack
              direction="row"
              sx={{ justifyContent: 'flex-end', gap: 2, touchAction: 'manipulation' }}
            >
              <Button onClick={close} disabled={committing} sx={buttonTouchSx}>
                Anuluj
              </Button>
              <Button
                variant="contained"
                onClick={() => void commit()}
                disabled={!canCommit || committing}
                startIcon={committing ? <BusyButtonProgress /> : undefined}
                sx={buttonTouchSx}
              >
                {committing ? 'Zapisywanie…' : 'Zapisz podpisany PDF'}
              </Button>
            </Stack>
          </Paper>
        )
      }
      fitMain={massMode}
    >
      {pdfError ? <Alert severity="error" sx={{ mb: 2 }}>{pdfError}</Alert> : null}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          flex: massMode ? '1 1 auto' : undefined,
          alignSelf: massMode ? 'stretch' : undefined,
          height: massMode ? '100%' : undefined,
        }}
      >
        {!pageReady && !pdfError ? <FileLoadingOverlay /> : null}
        <Box
          ref={fitBoxRef}
          sx={{
            width: '100%',
            height: massMode ? '100%' : undefined,
            display: massMode ? 'flex' : 'block',
            alignItems: massMode ? 'center' : undefined,
            justifyContent: massMode ? 'center' : undefined,
          }}
        >
          <SigningPageSurface
            sx={{
              position: 'relative',
              width: 'fit-content',
              maxWidth: '100%',
              maxHeight: massMode ? '100%' : undefined,
              mx: 'auto',
            }}
          >
            <canvas
              ref={pdfCanvasRef}
              aria-label={`Strona ${pageNumber} dokumentu PDF`}
              style={{
                display: 'block',
                maxHeight: massMode ? '100%' : undefined,
                maxWidth: '100%',
                height: 'auto',
              }}
            />
            <InkSurface
              ref={setInkCanvasRef}
              role="application"
              aria-label="Powierzchnia do rysowania podpisu"
              aria-busy={!pageReady}
              tabIndex={0}
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                cursor: gestureMode === 'draw' ? 'crosshair' : 'grab',
                touchAction:
                  gestureMode === 'draw' || stampTouchActionLocked
                    ? 'none'
                    : 'pan-x pan-y pinch-zoom',
              }}
            onPointerDown={(event) => {
              if (committing) return;
              if (event.pointerType === 'pen') {
                activePenPointerRef.current = event.pointerId;
                lastPenSeenAtRef.current = event.timeStamp;
                cancelActiveTouchStroke();
              }
              const ignoreTouch =
                gestureMode === 'draw' &&
                event.pointerType === 'touch' &&
                touchIgnoredForPenPriority(event);
              if (ignoreTouch) {
                event.preventDefault();
                return;
              }
              const points = pointerPoints(event);
              const point = points[0];
              if (!point) return;
              const hit = pointerStartsPlacementDrag(event)
                ? signingStampsForPage(stamps, pageIndex)
                    .slice()
                    .reverse()
                    .find(({ stamp }) => signingStampContainsPoint(stamp, point))
                : undefined;
              if (hit) {
                setSelectedStampIndex(hit.stampIndex);
                placementDragRef.current = {
                  pointerId: event.pointerId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  placement: hit.stamp.placement,
                  stampIndex: hit.stampIndex,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
              }
              if (placing) {
                setSelectedStampIndex(undefined);
                if (!pointerStartsPlacementDrag(event)) return;
                if (!strokes.length) return;
                const currentDraftStamp = draftStamp(pageIndex);
                if (!currentDraftStamp) return;
                if (!signingStampContainsPoint(currentDraftStamp, point)) return;
                placementDragRef.current = {
                  pointerId: event.pointerId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  placement,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
              }
              // WHY: only new ink needs a rendered page — gating the drag
              // branches above on it silently drops drags that start during a
              // re-fit render (any resize, rotation or toolbar reflow).
              if (!pageReady || !metrics) return;
              if (massMode) return;
              if (gestureMode === 'pan') return;
              if (!eventDrawsInk(event)) return;
              const stroke = {
                points,
                simulatePressure: pointerEventUsesSimulatedPressure(
                  event.nativeEvent,
                  event.pointerType,
                ),
              };
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
              if (gestureMode === 'draw' && touchIgnoredForPenPriority(event)) {
                if (placementDragRef.current?.pointerId === event.pointerId) {
                  placementDragRef.current = undefined;
                }
                cancelActiveTouchStroke();
                event.preventDefault();
                return;
              }
              const drag = placementDragRef.current;
              if (drag?.pointerId === event.pointerId) {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (bounds.width > 0 && bounds.height > 0) {
                  const next = {
                    ...drag.placement,
                    offsetX:
                      drag.placement.offsetX +
                      (event.clientX - drag.clientX) / bounds.width,
                    offsetY:
                      drag.placement.offsetY +
                      (event.clientY - drag.clientY) / bounds.height,
                  };
                  if (drag.stampIndex === undefined) {
                    setPlacement(clampSignaturePlacementToPage(strokes, next));
                  } else {
                    const stampIndex = drag.stampIndex;
                    setStamps((current) =>
                      updateSigningStampPlacement(current, stampIndex, next),
                    );
                  }
                }
                event.preventDefault();
                return;
              }
              if (activePointerRef.current !== event.pointerId) return;
              const current = currentStrokeRef.current;
              if (!current) return;
              const next = {
                ...current,
                points: [...current.points, ...pointerPoints(event)],
              };
              currentStrokeRef.current = next;
              setActiveStroke(next);
              event.preventDefault();
            }}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
          />
          </SigningPageSurface>
        </Box>
      </Box>
      <PadQrDialog
        open={remotePadQrOpen}
        loading={createRemotePadSession.isPending}
        onClose={() => setRemotePadQrOpen(false)}
        onCloseSession={() => void closeRemotePadSession()}
        {...(remotePadError === undefined ? {} : { error: remotePadError })}
        {...(remotePadQrDataUrl === undefined ? {} : { qrDataUrl: remotePadQrDataUrl })}
        {...(remotePadSession?.url === undefined ? {} : { sessionUrl: remotePadSession.url })}
      />
      <SignaturePadDialog
        open={signaturePadOpen}
        inkColorId={inkColorId}
        inkColor={inkColor}
        onInkColorChange={setInkColorId}
        onCancel={() => setSignaturePadOpen(false)}
        onUse={useSignaturePad}
      />
    </SigningShell>
  );
};
