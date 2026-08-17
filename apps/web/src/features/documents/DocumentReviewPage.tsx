import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  SvgIcon,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import {
  documentTypeSchema,
  selectableDocumentTypes,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  visibleFilterValues,
  type DocumentType,
  type DocumentWithFiles,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SigningShell } from '../../components/layout/SigningShell.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { PolishDatePicker } from '../../components/ui/PolishDatePicker.js';
import { SigningPageSurface } from '../../theme.js';
import {
  documentTypeLabel,
  documentsSearchFromReviewSearch,
  newestDocumentFileByRole,
  reviewModeFromSearch,
  reviewQueueFromSearch,
  suggestDocumentDate,
  toDocumentInput,
  type DocumentFormValues,
  type DocumentReviewMode,
} from './documents.logic.js';
import { loadSourcePdf, renderSourcePage } from './signing-pdf.js';

type LoadedPdf = Awaited<ReturnType<typeof loadSourcePdf>>;
type NavigationIntent =
  | { kind: 'close' }
  | { kind: 'document'; documentId: string }
  | { kind: 'mode'; mode: DocumentReviewMode };

const EMPTY_DOCUMENTS: DocumentWithFiles[] = [];

const bytesAsArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const CloseIcon = () => (
  <SvgIcon>
    <path
      d="M6 6l12 12M18 6 6 18"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </SvgIcon>
);

const formValuesForDocument = (
  document: DocumentWithFiles,
): DocumentFormValues => ({
  title: document.title,
  docType: document.docType,
  documentDate: document.documentDate,
  periodStart: document.periodStart ?? '',
  periodEnd: document.periodEnd ?? '',
  person: document.person ?? '',
  tags: document.tags,
});

const formFingerprint = (values: DocumentFormValues): string =>
  JSON.stringify({ ...values, tags: [...values.tags].sort() });

const Header = ({
  document,
  documentTypes,
  onClose,
}: {
  document?: DocumentWithFiles;
  documentTypes: DocumentType[];
  onClose: () => void;
}) => (
  <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1 }}>
    <Stack
      direction="row"
      sx={{ alignItems: 'center', gap: 1, minWidth: 0, overflow: 'hidden' }}
    >
      <Typography
        variant="h3"
        component="h1"
        noWrap
        sx={{ flex: '0 1 auto', maxWidth: { xs: '46vw', sm: '56vw' }, minWidth: 0 }}
      >
        {document?.title ?? 'Masowe przeglądanie'}
      </Typography>
      {document ? (
        <Chip
          size="small"
          variant="outlined"
          label={documentTypeLabel(documentTypes, document.docType)}
        />
      ) : null}
      {document?.person ? <Chip size="small" label={document.person} /> : null}
      {document?.tags.map((tag) => <Chip key={tag} size="small" label={tag} />)}
      <Box sx={{ flexGrow: 1 }} />
      <IconButton aria-label="Zamknij" onClick={onClose} sx={{ minWidth: 44, minHeight: 44 }}>
        <CloseIcon />
      </IconButton>
    </Stack>
  </Paper>
);

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

const EditForm = ({
  error,
  onChange,
  onSubmit,
  pending,
  personOptions,
  tagInput,
  tagOptions,
  documentTypes,
  values,
  onTagInputChange,
}: {
  error?: string;
  onChange: (values: DocumentFormValues) => void;
  onSubmit: (values: DocumentFormValues) => void;
  pending: boolean;
  personOptions: string[];
  tagInput: string;
  tagOptions: string[];
  documentTypes: DocumentType[];
  values: DocumentFormValues;
  onTagInputChange: (value: string) => void;
}) => {
  const [fieldErrors, setFieldErrors] = useState<{
    documentDate?: string;
    periodEnd?: string;
    title?: string;
  }>({});

  const field = (
    name: Exclude<keyof DocumentFormValues, 'tags'>,
    value: string,
  ) => {
    onChange(
      name === 'periodStart' || name === 'periodEnd'
        ? suggestDocumentDate(values, name, value)
        : { ...values, [name]: value },
    );
    if (name === 'title' || name === 'documentDate' || name === 'periodEnd') {
      setFieldErrors((current) => ({ ...current, [name]: undefined }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors = {
      ...(values.title.trim() ? {} : { title: 'Tytuł jest wymagany' }),
      ...(values.documentDate
        ? {}
        : { documentDate: 'Data podpisania jest wymagana' }),
      ...(values.periodStart && values.periodEnd && values.periodStart > values.periodEnd
        ? { periodEnd: 'Data końcowa nie może być wcześniejsza niż początkowa' }
        : {}),
    };
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) onSubmit(values);
  };

  return (
    <Paper
      component="form"
      onSubmit={submit}
      variant="outlined"
      sx={{ width: 'min(720px, 100%)', mx: 'auto', p: { xs: 2, md: 3 } }}
    >
      <Stack sx={{ gap: 2 }}>
        <TextField
          label="Tytuł"
          value={values.title}
          onChange={(event) => field('title', event.target.value)}
          error={Boolean(fieldErrors.title)}
          helperText={fieldErrors.title}
        />
        <FormControl required>
          <InputLabel id="review-document-type-label">Typ</InputLabel>
          <Select
            labelId="review-document-type-label"
            label="Typ"
            value={values.docType}
            onChange={(event) => field('docType', documentTypeSchema.parse(event.target.value))}
          >
            {documentTypes.map((documentType) => (
              <MenuItem key={documentType.slug} value={documentType.slug}>
                {documentType.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Autocomplete
          freeSolo
          options={personOptions}
          value={values.person}
          onChange={(_event, value) => field('person', value ?? '')}
          onInputChange={(_event, value) => field('person', value)}
          renderInput={(params) => <TextField {...params} label="Strona" />}
        />
        <Autocomplete
          multiple
          freeSolo
          options={tagOptions}
          value={values.tags}
          inputValue={tagInput}
          onChange={(_event, value) => {
            onChange({
              ...values,
              tags: Array.from(new Set(value.map((tag) => tag.trim()).filter(Boolean))),
            });
            onTagInputChange('');
          }}
          onInputChange={(_event, value) => onTagInputChange(value)}
          renderInput={(params) => <TextField {...params} label="Tagi" />}
        />
        <PolishDatePicker
          label="Data podpisania"
          value={values.documentDate}
          onChange={(value) => field('documentDate', value)}
          required
          error={Boolean(fieldErrors.documentDate)}
          helperText={fieldErrors.documentDate}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
          <PolishDatePicker
            label="Okres od"
            value={values.periodStart}
            onChange={(value) => field('periodStart', value)}
            sx={{ flex: 1 }}
          />
          <PolishDatePicker
            label="Okres do"
            value={values.periodEnd}
            onChange={(value) => field('periodEnd', value)}
            error={Boolean(fieldErrors.periodEnd)}
            helperText={fieldErrors.periodEnd}
            sx={{ flex: 1 }}
          />
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" disabled={pending}>
            {pending ? 'Zapisywanie…' : 'Zapisz'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
};

export const DocumentReviewPage = ({ documentId }: { documentId: string }) => {
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/documents/$id/review' });
  const queryClient = useQueryClient();
  const queue = reviewQueueFromSearch(search);
  const queueIndex = queue.indexOf(documentId);
  const listSearch = documentsSearchFromReviewSearch(search);
  const requestedMode = reviewModeFromSearch(search);
  const documentQuery = useQuery(actions.document(documentId));
  const documentTypesQuery = useQuery(actions.documentTypes);
  const hiddenFilterValuesQuery = useQuery(actions.hiddenFilterValues);
  const documentsQuery = useQuery(actions.documents({ draft: 'all' }));
  const document = documentQuery.data?.document;
  const documentTypes = documentTypesQuery.data?.documentTypes ?? [];
  const hiddenValues = hiddenFilterValuesQuery.data?.hiddenFilterValues ?? [];
  const sourceFile = document ? newestDocumentFileByRole(document, 'source') : undefined;
  const scanFile = document
    ? newestDocumentFileByRole(document, 'signed-scan')
    : undefined;
  const signedFile = document
    ? newestDocumentFileByRole(document, 'signed-digital')
    : undefined;
  const defaultMode: DocumentReviewMode = signedFile
    ? 'signed'
    : scanFile
      ? 'scan'
      : 'source';
  const mode = search.tryb === undefined ? defaultMode : requestedMode;
  const selectedFile =
    mode === 'signed' ? signedFile : mode === 'scan' ? scanFile : sourceFile;
  const fileQuery = useQuery({
    ...actions.documentFile(documentId, selectedFile?.id ?? ''),
    enabled: mode !== 'edit' && selectedFile !== undefined,
  });
  const [values, setValues] = useState<DocumentFormValues>();
  const [tagInput, setTagInput] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<NavigationIntent>();
  const [pdf, setPdf] = useState<LoadedPdf>();
  const [pdfError, setPdfError] = useState<string>();
  const [pageNumber, setPageNumber] = useState(1);
  const [pageRendering, setPageRendering] = useState(false);
  const [fitBox, setFitBox] = useState<{ height: number; width: number }>();
  const [imageUrl, setImageUrl] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fitBoxRef = useRef<HTMLDivElement>(null);

  const updateDocument = useMutation({
    ...actions.updateDocument,
    onSuccess: async () => {
      setTagInput('');
      await queryClient.invalidateQueries(actions.documentsInvalidates());
      await navigate({
        to: '/app/documents/$id/review',
        params: { id: documentId },
        search: { ...listSearch, kolejka: search.kolejka },
        replace: true,
      });
    },
  });

  useEffect(() => {
    if (!document) return;
    setValues(formValuesForDocument(document));
    setTagInput('');
    setPendingNavigation(undefined);
  }, [document, documentId]);

  useEffect(() => {
    if (queueIndex >= 0) return;
    void navigate({ to: '/app/documents', search: listSearch, replace: true });
  }, [listSearch, navigate, queueIndex]);

  useEffect(() => {
    if (
      !document ||
      (mode !== 'signed' && mode !== 'scan') ||
      (mode === 'signed' && signedFile) ||
      (mode === 'scan' && scanFile)
    ) {
      return;
    }
    void navigate({
      to: '/app/documents/$id/review',
      params: { id: documentId },
      search: { ...listSearch, kolejka: search.kolejka },
      replace: true,
    });
  }, [
    document,
    documentId,
    listSearch,
    mode,
    navigate,
    scanFile,
    search.kolejka,
    signedFile,
  ]);

  useEffect(() => {
    setPageNumber(1);
    setPdf(undefined);
    setPdfError(undefined);
    if (mode === 'edit' || !selectedFile || !fileQuery.data) return;
    if (selectedFile.contentType.toLowerCase() !== 'application/pdf') return;
    let active = true;
    let loadedPdf: LoadedPdf | undefined;
    void loadSourcePdf(fileQuery.data.bytes)
      .then((loaded) => {
        loadedPdf = loaded;
        if (active) setPdf(loaded);
        else void loaded.destroy();
      })
      .catch((error: unknown) => {
        if (active) {
          setPdfError(error instanceof Error ? error.message : 'Nie udało się otworzyć PDF.');
        }
      });
    return () => {
      active = false;
      if (loadedPdf) void loadedPdf.destroy();
    };
  }, [fileQuery.data, mode, selectedFile]);

  useEffect(() => {
    setImageUrl(undefined);
    if (
      mode === 'edit' ||
      !selectedFile ||
      !fileQuery.data ||
      !selectedFile.contentType.toLowerCase().startsWith('image/')
    ) {
      return;
    }
    const blob = new Blob([bytesAsArrayBuffer(fileQuery.data.bytes)], {
      type: selectedFile.contentType,
    });
    const url = URL.createObjectURL(blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [fileQuery.data, mode, selectedFile]);

  useEffect(() => {
    if (mode === 'edit') {
      setFitBox(undefined);
      return;
    }
    const element = fitBoxRef.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const next = {
        width: bounds.width > 0 ? Math.floor(bounds.width) : 0,
        height: bounds.height > 0 ? Math.floor(bounds.height) : 0,
      };
      if (next.width === 0 || next.height === 0) return;
      setFitBox((current) =>
        current?.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    measure();
    const animationFrame = window.requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      window.addEventListener('orientationchange', measure);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener('resize', measure);
        window.removeEventListener('orientationchange', measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [fileQuery.data, mode, selectedFile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !fitBox) return;
    let active = true;
    setPageRendering(true);
    setPdfError(undefined);
    void renderSourcePage(pdf, pageNumber, canvas, fitBox)
      .catch((error: unknown) => {
        if (active) {
          setPdfError(error instanceof Error ? error.message : 'Nie udało się wyświetlić strony.');
        }
      })
      .finally(() => {
        if (active) setPageRendering(false);
      });
    return () => {
      active = false;
    };
  }, [fitBox, pageNumber, pdf]);

  const valuesWithPendingTag = values
    ? {
        ...values,
        tags: Array.from(
          new Set([...values.tags, tagInput.trim()].filter(Boolean)),
        ),
      }
    : undefined;
  const dirty =
    document !== undefined &&
    valuesWithPendingTag !== undefined &&
    formFingerprint(valuesWithPendingTag) !==
      formFingerprint(formValuesForDocument(document));

  const reviewSearch = useCallback(
    (nextMode: DocumentReviewMode) => ({
      ...listSearch,
      kolejka: search.kolejka,
      ...(nextMode === 'signed'
        ? { tryb: 'podpisany' as const }
        : nextMode === 'scan'
          ? { tryb: 'skan' as const }
          : nextMode === 'edit'
            ? { tryb: 'edycja' as const }
            : { tryb: 'zrodlo' as const }),
    }),
    [listSearch, search.kolejka],
  );

  const performNavigation = (intent: NavigationIntent) => {
    setPendingNavigation(undefined);
    if (intent.kind === 'close') {
      void navigate({ to: '/app/documents', search: listSearch });
      return;
    }
    if (intent.kind === 'document') {
      void navigate({
        to: '/app/documents/$id/review',
        params: { id: intent.documentId },
        search: { ...listSearch, kolejka: search.kolejka },
      });
      return;
    }
    void navigate({
      to: '/app/documents/$id/review',
      params: { id: documentId },
      search: reviewSearch(intent.mode),
    });
  };

  const requestNavigation = (intent: NavigationIntent) => {
    if (mode === 'edit' && dirty) {
      setPendingNavigation(intent);
      return;
    }
    performNavigation(intent);
  };

  const previousDocumentId = queue[queueIndex - 1];
  const nextDocumentId = queue[queueIndex + 1];
  const allDocuments = documentsQuery.data?.documents ?? EMPTY_DOCUMENTS;
  const controls = (
    <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 0.75 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ alignItems: 'center', justifyContent: 'center', gap: 1 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={mode}
          aria-label="Tryb przeglądania"
          onChange={(_event, selected: DocumentReviewMode | null) => {
            if (selected) requestNavigation({ kind: 'mode', mode: selected });
          }}
        >
          <ToggleButton value="source">Źródło</ToggleButton>
          {scanFile ? <ToggleButton value="scan">Skan</ToggleButton> : null}
          <Tooltip
            title={signedFile ? '' : 'Ten dokument nie ma podpisanego pliku cyfrowego'}
          >
            <span>
              <ToggleButton value="signed" disabled={!signedFile}>
                Podpisany
              </ToggleButton>
            </span>
          </Tooltip>
          <ToggleButton value="edit">Edycja</ToggleButton>
        </ToggleButtonGroup>
        {mode !== 'edit' && pdf && pdf.numPages > 1 ? (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            <Button
              size="small"
              disabled={pageNumber === 1 || pageRendering}
              onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            >
              Poprzednia strona
            </Button>
            <Typography variant="body2" aria-live="polite">
              str. {pageNumber} z {pdf.numPages}
            </Typography>
            <Button
              size="small"
              disabled={pageNumber === pdf.numPages || pageRendering}
              onClick={() => setPageNumber((current) => Math.min(pdf.numPages, current + 1))}
            >
              Następna strona
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );

  const footer = (
    <Paper square sx={{ px: { xs: 1.5, md: 3 }, py: 1.5 }}>
      {pendingNavigation ? (
        <Alert
          severity="warning"
          sx={{ mb: 1 }}
          action={
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button
                color="inherit"
                size="small"
                onClick={() => setPendingNavigation(undefined)}
              >
                Wróć
              </Button>
              <Button
                color="inherit"
                size="small"
                onClick={() => performNavigation(pendingNavigation)}
              >
                Odrzuć zmiany
              </Button>
            </Stack>
          }
        >
          Ten dokument ma niezapisane zmiany.
        </Alert>
      ) : null}
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Button
          variant="outlined"
          disabled={!previousDocumentId}
          onClick={() => {
            if (previousDocumentId) {
              requestNavigation({ kind: 'document', documentId: previousDocumentId });
            }
          }}
        >
          Wstecz
        </Button>
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          Dokument {queueIndex + 1} z {queue.length}
        </Typography>
        <Button
          variant="contained"
          disabled={!nextDocumentId}
          onClick={() => {
            if (nextDocumentId) {
              requestNavigation({ kind: 'document', documentId: nextDocumentId });
            }
          }}
        >
          Dalej
        </Button>
      </Stack>
    </Paper>
  );

  return (
    <SigningShell
      header={
        <Header
          {...(document === undefined ? {} : { document })}
          documentTypes={documentTypes}
          onClose={() => requestNavigation({ kind: 'close' })}
        />
      }
      controls={controls}
      footer={footer}
      fitMain={mode !== 'edit'}
      selectionLocked={false}
    >
      {documentQuery.isPending ? (
        <StatusView state={{ kind: 'loading', label: 'Otwieranie dokumentu…' }} />
      ) : documentQuery.isError ? (
        <StatusView state={{ kind: 'error', message: documentQuery.error.message }} />
      ) : mode === 'edit' && values ? (
        <EditForm
          values={values}
          tagInput={tagInput}
          personOptions={visibleFilterValues(
            uniqueDocumentPersons(allDocuments),
            hiddenValues,
            'person',
          )}
          tagOptions={visibleFilterValues(uniqueDocumentTags(allDocuments), hiddenValues, 'tag')}
          documentTypes={selectableDocumentTypes(documentTypes, values.docType)}
          pending={updateDocument.isPending}
          {...(updateDocument.error === null
            ? {}
            : { error: updateDocument.error.message })}
          onChange={setValues}
          onTagInputChange={setTagInput}
          onSubmit={(submittedValues) => {
            const submittedWithTag = {
              ...submittedValues,
              tags: Array.from(
                new Set([...submittedValues.tags, tagInput.trim()].filter(Boolean)),
              ),
            };
            updateDocument.mutate({
              documentId,
              input: toDocumentInput(submittedWithTag),
            });
          }}
        />
      ) : !selectedFile ? (
        <StatusView
          state={{
            kind: 'empty',
            title: mode === 'signed' ? 'Brak podpisanego pliku' : 'Brak pliku źródłowego',
            body:
              mode === 'signed'
                ? 'Ten dokument nie ma podpisanego pliku cyfrowego.'
                : 'Dodaj źródłowy PDF lub obraz, aby go przejrzeć.',
          }}
        />
      ) : fileQuery.isError ? (
        <StatusView state={{ kind: 'error', message: fileQuery.error.message }} />
      ) : selectedFile.contentType.toLowerCase() === 'application/pdf' ? (
        <Box
          ref={fitBoxRef}
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {pdfError ? <Alert severity="error">{pdfError}</Alert> : null}
          {fileQuery.isPending ||
          (fileQuery.isSuccess && !pdf && !pdfError) ||
          pageRendering ? (
            <FileLoadingOverlay />
          ) : null}
          <SigningPageSurface sx={{ width: 'fit-content', maxWidth: '100%', maxHeight: '100%' }}>
            <canvas
              ref={canvasRef}
              aria-label={`Strona ${pageNumber} dokumentu PDF`}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', height: 'auto' }}
            />
          </SigningPageSurface>
        </Box>
      ) : selectedFile.contentType.toLowerCase().startsWith('image/') ? (
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {fileQuery.isPending || !imageUrl ? <FileLoadingOverlay /> : null}
          {imageUrl ? (
            <SigningPageSurface sx={{ maxWidth: '100%', maxHeight: '100%' }}>
              <Box
                component="img"
                src={imageUrl}
                alt={selectedFile.fileName}
                sx={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </SigningPageSurface>
          ) : null}
        </Box>
      ) : (
        <StatusView
          state={{
            kind: 'error',
            message: 'Ten format pliku nie może być wyświetlony w przeglądarce.',
          }}
        />
      )}
    </SigningShell>
  );
};
