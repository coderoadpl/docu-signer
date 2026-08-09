import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Slider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { SigningShell } from '../../components/layout/SigningShell.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { InkSurface, SigningPageSurface } from '../../theme.js';
import {
  DEFAULT_SIGNING_INK_COLOR,
  SIGNING_INK_COLORS,
  appendSigningStamp,
  centeredInkPlacement,
  createSigningStamp,
  defaultSigningGestureMode,
  documentPointerDrawsInk,
  isPalmSizedTouch,
  placeInkPoint,
  penPriorityActive,
  pointerEventToInkPoints,
  placedInkBounds,
  removeSigningStamp,
  signingStampContainsPoint,
  signingStampsForPage,
  signedFileName,
  signingInkColorById,
  smoothStroke,
  stampEveryPage,
  updateSigningStampPlacement,
  type CanvasPdfMetrics,
  type InkStroke,
  type SignaturePlacement,
  type SigningGestureMode,
  type SigningInkColorId,
  type SigningStamp,
} from './signing.js';
import { canSignPdfFile, uploadErrorMessage } from './documents.logic.js';
import {
  flattenSignedPdf,
  loadSourcePdf,
  renderSourcePage,
  sourcePageMetrics,
} from './signing-pdf.js';
import { uploadDocumentFile } from './upload.logic.js';

type LoadedPdf = Awaited<ReturnType<typeof loadSourcePdf>>;

const DEFAULT_PLACEMENT: SignaturePlacement = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

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

interface InkLayer {
  strokes: InkStroke[];
  placement: SignaturePlacement;
  color: string;
  selected: boolean;
}

const drawInk = (
  canvas: HTMLCanvasElement,
  layers: InkLayer[],
  metrics: CanvasPdfMetrics,
) => {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const layer of layers) {
    context.strokeStyle = layer.color;
    for (const stroke of layer.strokes) {
      const placed = {
        points: stroke.points.map((point) =>
          placeInkPoint(point, layer.strokes, layer.placement),
        ),
      };
      for (const segment of smoothStroke(placed)) {
        const pressure =
          (segment.start.pressure + segment.control.pressure + segment.end.pressure) / 3;
        context.beginPath();
        context.moveTo(
          segment.start.x * canvas.width,
          segment.start.y * canvas.height,
        );
        context.quadraticCurveTo(
          segment.control.x * canvas.width,
          segment.control.y * canvas.height,
          segment.end.x * canvas.width,
          segment.end.y * canvas.height,
        );
        context.lineWidth = (1.5 + pressure * 2.5) * metrics.devicePixelRatio;
        context.stroke();
      }
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

const canvasMetrics = (
  canvas: HTMLCanvasElement,
  fallback: { width: number; height: number },
): CanvasPdfMetrics => {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = bounds.width > 0 ? bounds.width : fallback.width;
  const cssHeight = bounds.height > 0 ? bounds.height : fallback.height;
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
  onUse: (strokes: InkStroke[]) => void;
  open: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentStrokeRef = useRef<InkStroke | undefined>(undefined);
  const activePointerRef = useRef<number | undefined>(undefined);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();

  useEffect(() => {
    if (!open) return;
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    setStrokes([]);
    setActiveStroke(undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateMetrics = () => {
      setMetrics(canvasMetrics(canvas, { width: 760, height: 280 }));
    };
    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    return () => window.removeEventListener('resize', updateMetrics);
  }, [open]);

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

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    const stroke = currentStrokeRef.current;
    if (stroke?.points.length) setStrokes((current) => [...current, stroke]);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    setActiveStroke(undefined);
    event.preventDefault();
  };

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="md">
      <DialogTitle>Złóż podpis</DialogTitle>
      <DialogContent>
        <InkSurface
          ref={canvasRef}
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
            const points = pointsForEvent(event);
            if (!points.length) return;
            const stroke = { points };
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
            const next = { points: [...current.points, ...points] };
            currentStrokeRef.current = next;
            setActiveStroke(next);
            event.preventDefault();
          }}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button
          onClick={() => setStrokes((current) => current.slice(0, -1))}
          disabled={!strokes.length}
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
        <Button onClick={onCancel}>Anuluj</Button>
        <Button
          variant="contained"
          onClick={() => onUse(strokes)}
          disabled={!strokes.length}
        >
          Użyj podpisu
        </Button>
      </DialogActions>
    </Dialog>
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

export const DocumentSigningPage = ({
  documentId,
  fileId,
}: {
  documentId: string;
  fileId: string;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documentQuery = useQuery(actions.document(documentId));
  const sourceQuery = useQuery(actions.documentFile(documentId, fileId));
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [pdfError, setPdfError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageRendering, setPageRendering] = useState(false);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [metricsPageNumber, setMetricsPageNumber] = useState<number>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();
  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);
  const [stamps, setStamps] = useState<SigningStamp[]>([]);
  const [selectedStampIndex, setSelectedStampIndex] = useState<number>();
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
  const [committing, setCommitting] = useState(false);

  const close = () =>
    void navigate({ to: '/app/documents/$id', params: { id: documentId } });

  const sourceFile = documentQuery.data?.document.files.find(
    (file) => file.id === fileId,
  );
  const signable = sourceFile ? canSignPdfFile(sourceFile) : false;
  const inkColor = signingInkColorById(inkColorId);
  const pageIndex = pageNumber - 1;
  const selectedStamp =
    selectedStampIndex === undefined ? undefined : stamps[selectedStampIndex];
  const activePlacement = selectedStamp?.placement ?? placement;
  const pageReady = Boolean(
    metrics && metricsPageNumber === pageNumber && !pageRendering,
  );
  const canCommit = Boolean(pageReady && (stamps.length > 0 || strokes.length > 0));

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
  }, [signable, sourceQuery.data]);

  useEffect(() => {
    const pdfCanvas = pdfCanvasRef.current;
    const inkCanvas = inkCanvasRef.current;
    if (!pdf || !pdfCanvas || !inkCanvas) return;
    let current = true;
    setPageRendering(true);
    setMetrics(undefined);
    setMetricsPageNumber(undefined);
    void renderSourcePage(pdf, pageNumber, pdfCanvas)
      .then((renderedMetrics) => {
        if (!current) return;
        inkCanvas.width = pdfCanvas.width;
        inkCanvas.height = pdfCanvas.height;
        setMetrics(renderedMetrics);
        setMetricsPageNumber(pageNumber);
        setPageRendering(false);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setPdfError(`Nie udało się wyświetlić strony: ${String(error)}`);
        setPageRendering(false);
      });
    return () => {
      current = false;
    };
  }, [pageNumber, pdf]);

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

  if (documentQuery.isPending || sourceQuery.isPending) {
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

  if (documentQuery.isError || sourceQuery.isError) {
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
              'Nie udało się pobrać dokumentu.',
          }}
        />
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

  const pointerDrawsInk = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    documentPointerDrawsInk({
      fingerDrawing,
      mode: gestureMode,
      penPriority: touchIgnoredForPenPriority(event),
      pointer: {
        height: event.height,
        pointerType: event.pointerType,
        width: event.width,
      },
    });

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

  const draftStamp = (targetPageIndex: number) =>
    createSigningStamp({
      pageIndex: targetPageIndex,
      strokes,
      placement,
      inkColor,
    });

  const stampCurrentPage = () => {
    if (!pageReady || !strokes.length) return;
    const next = appendSigningStamp(stamps, draftStamp(pageIndex));
    setStamps(next);
    setSelectedStampIndex(next.length - 1);
    setPlacing(true);
  };

  const useSignaturePad = (padStrokes: InkStroke[]) => {
    if (!pageReady || !padStrokes.length) return;
    const next = appendSigningStamp(
      stamps,
      createSigningStamp({
        pageIndex,
        strokes: padStrokes,
        placement: centeredInkPlacement(padStrokes),
        inkColor,
      }),
    );
    setStamps(next);
    setSelectedStampIndex(next.length - 1);
    setPlacing(true);
    setSignaturePadOpen(false);
  };

  const stampAllPages = () => {
    if (!pageReady || !strokes.length || !pdf) return;
    const next = stampEveryPage(
      stamps,
      {
        strokes,
        placement,
        inkColor,
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
    const committedStamps =
      stamps.length > 0 ? stamps : [draftStamp(pageIndex)];
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

  const commit = async () => {
    if (!canCommit) return;
    setCommitting(true);
    setCommitError(undefined);
    try {
      const signedBytes = await flattenSignedPdf(
        sourceQuery.data.bytes,
        await flattenedStamps(),
      );
      const output = new File(
        [bytesAsArrayBuffer(signedBytes)],
        signedFileName(sourceFile.fileName),
        { type: 'application/pdf' },
      );
      await uploadDocumentFile(output, 'signed-digital', {
        request: (input) =>
          requestUpload.mutateAsync({ documentId, input }),
        direct: (input) => directUpload.mutateAsync(input),
        finalize: (input) =>
          finalizeUpload.mutateAsync({ documentId, input }),
        server: (input) =>
          serverUpload.mutateAsync({ documentId, input }),
      });
      await queryClient.invalidateQueries(actions.documentsInvalidates());
      await navigate({
        to: '/app/documents/$id',
        params: { id: documentId },
        replace: true,
      });
    } catch (error) {
      setCommitError(uploadErrorMessage(error));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <SigningShell
      header={<PageHeader fileName={sourceFile.fileName} onClose={close} />}
      controls={
        <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <Button
              onClick={() => setPageNumber((page) => Math.max(1, page - 1))}
              disabled={pageNumber === 1 || pageRendering}
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
            >
              Następna →
            </Button>
            <Button
              variant="contained"
              onClick={() => setSignaturePadOpen(true)}
              disabled={!pageReady || committing}
            >
              Złóż podpis
            </Button>
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
            >
              Wyczyść
            </Button>
            <Button
              variant={placing ? 'contained' : 'outlined'}
              onClick={() => setPlacing((current) => !current)}
              disabled={(!strokes.length && selectedStampIndex === undefined) || committing}
            >
              {placing ? 'Wróć do rysowania' : 'Ustaw położenie'}
            </Button>
            <Button
              variant="contained"
              onClick={stampCurrentPage}
              disabled={!pageReady || !strokes.length || committing}
            >
              Przybij na tej stronie
            </Button>
            <Button
              variant="contained"
              onClick={stampAllPages}
              disabled={!pageReady || !strokes.length || !pdf || committing}
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
            <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mt: 1 }}>
              <Typography id="signature-size">Rozmiar</Typography>
              <Slider
                aria-labelledby="signature-size"
                min={50}
                max={200}
                value={Math.round(activePlacement.scale * 100)}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value}%`}
                onChange={(_, value) => {
                  if (typeof value === 'number') {
                    const next = { ...activePlacement, scale: value / 100 };
                    if (selectedStampIndex === undefined) {
                      setPlacement(next);
                    } else {
                      setStamps(
                        updateSigningStampPlacement(stamps, selectedStampIndex, next),
                      );
                    }
                  }
                }}
                sx={{ maxWidth: 240 }}
              />
              <Button
                color="error"
                onClick={removeSelectedStamp}
                disabled={selectedStampIndex === undefined || committing}
                sx={{ minHeight: 44 }}
              >
                Usuń
              </Button>
              <Typography variant="body2">
                {selectedStamp
                  ? `Wybrany odcisk: strona ${selectedStamp.pageIndex + 1}`
                  : 'Położenie bieżącego rysunku'}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Odciski w sesji: {stamps.length}
            </Typography>
          )}
        </Paper>
      }
      footer={
        <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1.5 }}>
          {commitError ? <Alert severity="error" sx={{ mb: 1 }}>{commitError}</Alert> : null}
          <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 2 }}>
            <Button onClick={close} disabled={committing}>Anuluj</Button>
            <Button
              variant="contained"
              onClick={() => void commit()}
              disabled={!canCommit || committing}
            >
              {committing ? 'Zapisywanie…' : 'Zapisz podpisany PDF'}
            </Button>
          </Stack>
        </Paper>
      }
    >
      {pdfError ? <Alert severity="error" sx={{ mb: 2 }}>{pdfError}</Alert> : null}
      {pageRendering ? <LinearProgress aria-label="Renderowanie strony PDF" /> : null}
      <SigningPageSurface
        sx={{ position: 'relative', width: 'fit-content', maxWidth: '100%', mx: 'auto' }}
      >
        <canvas
          ref={pdfCanvasRef}
          aria-label={`Strona ${pageNumber} dokumentu PDF`}
          style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        />
        <InkSurface
          ref={inkCanvasRef}
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
              gestureMode === 'draw' ? 'none' : 'pan-x pan-y pinch-zoom',
          }}
          onPointerDown={(event) => {
            if (!pageReady || !metrics || committing) return;
            if (event.pointerType === 'pen') {
              activePenPointerRef.current = event.pointerId;
              lastPenSeenAtRef.current = event.timeStamp;
              cancelActiveTouchStroke();
            }
            const ignoreTouch =
              gestureMode === 'draw' &&
              event.pointerType === 'touch' &&
              (touchIgnoredForPenPriority(event) ||
                isPalmSizedTouch({
                  height: event.height,
                  pointerType: event.pointerType,
                  width: event.width,
                }));
            if (ignoreTouch) {
              event.preventDefault();
              return;
            }
            const points = pointerPoints(event);
            const point = points[0];
            if (!point) return;
            const hit = signingStampsForPage(stamps, pageIndex)
              .slice()
              .reverse()
              .find(({ stamp }) => signingStampContainsPoint(stamp, point));
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
              if (!strokes.length) return;
              if (!signingStampContainsPoint(draftStamp(pageIndex), point)) return;
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
            if (gestureMode === 'pan') return;
            if (!pointerDrawsInk(event)) return;
            const stroke = { points };
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
                  offsetX: drag.placement.offsetX + (event.clientX - drag.clientX) / bounds.width,
                  offsetY: drag.placement.offsetY + (event.clientY - drag.clientY) / bounds.height,
                };
                if (drag.stampIndex === undefined) {
                  setPlacement(next);
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
            const next = { points: [...current.points, ...pointerPoints(event)] };
            currentStrokeRef.current = next;
            setActiveStroke(next);
            event.preventDefault();
          }}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
      </SigningPageSurface>
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
