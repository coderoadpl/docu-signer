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
  placeInkPoint,
  pointerToInkPoint,
  signedFileName,
  signingInkColorById,
  smoothStroke,
  type CanvasPdfMetrics,
  type InkStroke,
  type SignaturePlacement,
  type SigningInkColorId,
} from './core/signing.js';
import { canSignPdfFile, uploadErrorMessage } from './documents.logic.js';
import {
  flattenSignedPdf,
  loadSourcePdf,
  renderSourcePage,
} from './signing-pdf.js';
import { uploadDocumentFile } from './upload.logic.js';

type LoadedPdf = Awaited<ReturnType<typeof loadSourcePdf>>;

const DEFAULT_PLACEMENT: SignaturePlacement = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

const bytesAsArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const drawInk = (
  canvas: HTMLCanvasElement,
  strokes: InkStroke[],
  placement: SignaturePlacement,
  metrics: CanvasPdfMetrics,
  color: string,
) => {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    const placed = {
      points: stroke.points.map((point) =>
        placeInkPoint(point, strokes, placement),
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
  const placementDragRef = useRef<
    {
      pointerId: number;
      clientX: number;
      clientY: number;
      placement: SignaturePlacement;
    } | undefined
  >(undefined);
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [pdfError, setPdfError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageRendering, setPageRendering] = useState(false);
  const [metrics, setMetrics] = useState<CanvasPdfMetrics>();
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<InkStroke>();
  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);
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
    void renderSourcePage(pdf, pageNumber, pdfCanvas)
      .then((renderedMetrics) => {
        if (!current) return;
        inkCanvas.width = pdfCanvas.width;
        inkCanvas.height = pdfCanvas.height;
        setMetrics(renderedMetrics);
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
    drawInk(
      canvas,
      activeStroke ? [...strokes, activeStroke] : strokes,
      placement,
      metrics,
      inkColor.canvasColor,
    );
  }, [activeStroke, inkColor.canvasColor, metrics, placement, strokes]);

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

  const pointerPoint = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    pointerToInkPoint(
      event.clientX,
      event.clientY,
      event.pressure,
      event.currentTarget.getBoundingClientRect(),
    );

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (placing) {
      if (placementDragRef.current?.pointerId === event.pointerId) {
        placementDragRef.current = undefined;
      }
      return;
    }
    if (activePointerRef.current !== event.pointerId) return;
    const stroke = currentStrokeRef.current;
    if (stroke?.points.length) setStrokes((current) => [...current, stroke]);
    currentStrokeRef.current = undefined;
    activePointerRef.current = undefined;
    setActiveStroke(undefined);
  };

  const commit = async () => {
    const canvas = inkCanvasRef.current;
    if (!metrics || !canvas || !strokes.length) return;
    setCommitting(true);
    setCommitError(undefined);
    try {
      const bounds = canvas.getBoundingClientRect();
      const signedBytes = await flattenSignedPdf(
        sourceQuery.data.bytes,
        pageNumber - 1,
        strokes,
        placement,
        { ...metrics, cssWidth: bounds.width, cssHeight: bounds.height },
        inkColor,
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
              }}
              disabled={!strokes.length || committing}
            >
              Wyczyść
            </Button>
            <Button
              variant={placing ? 'contained' : 'outlined'}
              onClick={() => setPlacing((current) => !current)}
              disabled={!strokes.length || committing}
            >
              {placing ? 'Wróć do rysowania' : 'Ustaw podpis'}
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
          </Stack>
          {placing ? (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mt: 1 }}>
              <Typography id="signature-size">Rozmiar</Typography>
              <Slider
                aria-labelledby="signature-size"
                min={50}
                max={200}
                value={Math.round(placement.scale * 100)}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${value}%`}
                onChange={(_, value) => {
                  if (typeof value === 'number') {
                    setPlacement((current) => ({ ...current, scale: value / 100 }));
                  }
                }}
                sx={{ maxWidth: 240 }}
              />
              <Typography variant="body2">Przeciągnij podpis po stronie.</Typography>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Narysuj podpis piórkiem, palcem albo myszą na wybranej stronie.
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
              disabled={!strokes.length || !metrics || committing}
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
          tabIndex={0}
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          onPointerDown={(event) => {
            if (!metrics || committing) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            if (placing) {
              placementDragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                placement,
              };
              return;
            }
            const stroke = { points: [pointerPoint(event)] };
            activePointerRef.current = event.pointerId;
            currentStrokeRef.current = stroke;
            setActiveStroke(stroke);
          }}
          onPointerMove={(event) => {
            const drag = placementDragRef.current;
            if (placing && drag?.pointerId === event.pointerId) {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (bounds.width > 0 && bounds.height > 0) {
                setPlacement({
                  ...drag.placement,
                  offsetX: drag.placement.offsetX + (event.clientX - drag.clientX) / bounds.width,
                  offsetY: drag.placement.offsetY + (event.clientY - drag.clientY) / bounds.height,
                });
              }
              return;
            }
            if (activePointerRef.current !== event.pointerId) return;
            const current = currentStrokeRef.current;
            if (!current) return;
            const next = { points: [...current.points, pointerPoint(event)] };
            currentStrokeRef.current = next;
            setActiveStroke(next);
          }}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
      </SigningPageSurface>
    </SigningShell>
  );
};
