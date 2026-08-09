import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputLabel,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  SvgIcon,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';

import {
  documentSignatureStatusSchema,
  documentTypeSchema,
  type DocumentType,
  type DocumentWithFiles,
  type SavedSearch,
  type SavedSearchFilter,
  type UpdateDocument,
  type UserPreferenceValue,
} from '#core/domain/index.js';

import { actions, preferenceActions, savedSearchActions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { PolishDatePicker } from '../../components/ui/PolishDatePicker.js';
import { formatPolishDate } from '../../lib/format-date.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import { DocumentTimelineView } from './DocumentTimelineView.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  FILE_ROLE_SHORT_LABELS,
  SIGNATURE_STATUS_LABELS,
  documentFiltersFromSearch,
  documentFilterSummary,
  documentsSearchFromState,
  documentsViewFromSearch,
  emptyDocumentFilters,
  formatCanonicalDocumentInterval,
  groupDocumentsCanonically,
  hasSignedDocumentFile,
  hasDocumentFilter,
  massSigningQueueSearch,
  massSigningQueueTargets,
  toDocumentFilter,
  toDocumentFilterValues,
  toDocumentInput,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  type DocumentsView,
  type DocumentFilterValues,
} from './documents.logic.js';

const FileCounts = ({ files }: { files: Array<{ role: string }> }) => {
  const present = (['source', 'signed-scan', 'signed-digital', 'other'] as const)
    .map((role) => ({
      role,
      count: files.filter((file) => file.role === role).length,
    }))
    .filter(({ count }) => count > 0);
  if (present.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Brak plików
      </Typography>
    );
  }
  return (
    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
      {present.map(({ role, count }) => (
        <Tooltip
          key={role}
          title={`${FILE_ROLE_LABELS[role]}: ${count}`}
          describeChild
          disableInteractive
        >
          <Chip
            size="small"
            variant="outlined"
            color={role === 'signed-scan' || role === 'signed-digital' ? 'success' : 'default'}
            label={count > 1 ? `${FILE_ROLE_SHORT_LABELS[role]} · ${count}` : FILE_ROLE_SHORT_LABELS[role]}
            aria-label={`${FILE_ROLE_LABELS[role]}: ${count}`}
          />
        </Tooltip>
      ))}
    </Stack>
  );
};

const ArrowUpIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M7 14l5-5 5 5H7Z" />
  </SvgIcon>
);

const ArrowDownIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M7 10l5 5 5-5H7Z" />
  </SvgIcon>
);

const MoreVertIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </SvgIcon>
);

const DOCUMENT_COLUMNS_KEY = 'documents.columns';
const TEXT_FILTER_DEBOUNCE_MS = 300;
const EMPTY_DOCUMENT_LIST: DocumentWithFiles[] = [];

const DOCUMENT_COLUMN_IDS = [
  'documentDate',
  'title',
  'docType',
  'person',
  'tags',
  'period',
  'signatureStatus',
  'files',
  'draft',
] as const;

type DocumentColumnId = (typeof DOCUMENT_COLUMN_IDS)[number];

interface DocumentColumnSettings {
  order: DocumentColumnId[];
  visible: DocumentColumnId[];
}

const DOCUMENT_COLUMN_LABELS: Record<DocumentColumnId, string> = {
  documentDate: 'Data podpisania',
  title: 'Tytuł',
  docType: 'Typ',
  person: 'Osoba',
  tags: 'Tagi',
  period: 'Okres',
  signatureStatus: 'Status podpisu',
  files: 'Pliki',
  draft: 'Szkic',
};

const documentColumnPreferenceSchema = z.object({
  order: z.array(z.enum(DOCUMENT_COLUMN_IDS)),
  visible: z.array(z.enum(DOCUMENT_COLUMN_IDS)),
});

const defaultDocumentColumnSettings = (): DocumentColumnSettings => ({
  order: Array.from(DOCUMENT_COLUMN_IDS),
  visible: ['documentDate', 'title', 'docType', 'person', 'files', 'draft'],
});

const normalizeDocumentColumnSettings = (value: unknown): DocumentColumnSettings => {
  const fallback = defaultDocumentColumnSettings();
  const parsed = documentColumnPreferenceSchema.safeParse(value);
  if (!parsed.success) return fallback;
  const known = new Set<DocumentColumnId>(DOCUMENT_COLUMN_IDS);
  const order = [
    ...parsed.data.order.filter((column) => known.has(column)),
    ...DOCUMENT_COLUMN_IDS.filter((column) => !parsed.data.order.includes(column)),
  ];
  const visible = parsed.data.visible.filter((column) => known.has(column));
  return {
    order,
    visible: visible.length > 0 ? visible : fallback.visible,
  };
};

const toColumnPreferenceValue = (
  settings: DocumentColumnSettings,
): UserPreferenceValue => ({
  order: settings.order,
  visible: settings.visible,
});

const signedStatus = (document: DocumentWithFiles) =>
  hasSignedDocumentFile(document)
    ? 'signed'
    : 'needs-signature';

type BulkDialog = 'add-tags' | 'remove-tag' | 'person' | 'type';

interface BulkSummary {
  changed: number;
  errors: number;
}

const toUpdateDocumentInput = (
  document: DocumentWithFiles,
  overrides: Partial<Pick<UpdateDocument, 'docType' | 'person' | 'tags'>>,
): UpdateDocument => ({
  title: document.title,
  docType: overrides.docType ?? document.docType,
  documentDate: document.documentDate,
  periodStart: document.periodStart,
  periodEnd: document.periodEnd,
  person: overrides.person ?? document.person,
  tags: overrides.tags ?? document.tags,
});

const trashErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Nie udało się wykonać akcji w koszu.';

const TRASH_EMPTY_CONFIRMATION = 'OPRÓŻNIJ KOSZ';

const saveDownload = (download: {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}) => {
  const body = new ArrayBuffer(download.bytes.byteLength);
  new Uint8Array(body).set(download.bytes);
  const url = URL.createObjectURL(new Blob([body], { type: download.contentType }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = download.fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export const DocumentsPage = () => {
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/documents' });
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [savedSearchOpen, setSavedSearchOpen] = useState(false);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog | null>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkRemoveTag, setBulkRemoveTag] = useState('');
  const [bulkPerson, setBulkPerson] = useState('');
  const [bulkDocType, setBulkDocType] = useState<DocumentType>('umowa-uod');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<BulkSummary | null>(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const [rowMenuDocument, setRowMenuDocument] = useState<DocumentWithFiles | null>(null);
  const [trashConfirmDocument, setTrashConfirmDocument] = useState<DocumentWithFiles | null>(null);
  const [trashBusyIds, setTrashBusyIds] = useState<string[]>([]);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashSummary, setTrashSummary] = useState<{ deleted: number; errors: number } | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashConfirmation, setEmptyTrashConfirmation] = useState('');
  const [archiveHasDocuments, setArchiveHasDocuments] = useState(false);
  const [columnSettings, setColumnSettings] = useState<DocumentColumnSettings>(
    defaultDocumentColumnSettings,
  );
  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  const view = useMemo(() => documentsViewFromSearch(search), [search]);
  const filters = useMemo(() => documentFiltersFromSearch(search), [search]);
  const [textFilter, setTextFilter] = useState(filters.text);
  const documentFilter = toDocumentFilter(filters);
  const documents = useQuery(actions.documents(documentFilter));
  const folderDocuments = useQuery(actions.documents({ draft: 'all' }));
  const trashedDocuments = useQuery(actions.trashedDocuments);
  const savedSearches = useQuery(savedSearchActions.savedSearches);
  const columnPreference = useQuery(preferenceActions.userPreference(DOCUMENT_COLUMNS_KEY));
  const createDocument = useMutation({
    ...actions.createDocument,
    onSuccess: async ({ document }) => {
      setCreateOpen(false);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
      await navigate({
        to: '/app/documents/$id',
        params: { id: document.id },
      });
    },
  });
  const exportDocuments = useMutation({
    ...actions.exportDocuments,
    onSuccess: saveDownload,
  });
  const bulkUpdateDocument = useMutation(actions.updateDocument);
  const bulkDeleteDocument = useMutation(actions.deleteDocument);
  const createSavedSearch = useMutation({
    ...savedSearchActions.createSavedSearch,
    onSuccess: async () => {
      setSavedSearchOpen(false);
      setSavedSearchName('');
      await queryClient.invalidateQueries(savedSearchActions.savedSearchesInvalidates());
    },
  });
  const deleteSavedSearch = useMutation({
    ...savedSearchActions.deleteSavedSearch,
    onSuccess: async () => {
      setConfirmDeleteId(null);
      await queryClient.invalidateQueries(savedSearchActions.savedSearchesInvalidates());
    },
  });
  const restoreDocument = useMutation(actions.restoreDocument);
  const purgeDocument = useMutation(actions.purgeDocument);
  const setColumnPreference = useMutation({
    ...preferenceActions.setUserPreference,
    onSuccess: async () => {
      await queryClient.invalidateQueries(
        preferenceActions.userPreferenceInvalidates(DOCUMENT_COLUMNS_KEY),
      );
    },
  });

  const navigateToDocumentsSearch = useCallback(
    (
      nextView: DocumentsView,
      nextFilters: DocumentFilterValues,
      replace: boolean,
    ) =>
      navigate({
        to: '/app/documents',
        search: documentsSearchFromState(nextView, nextFilters),
        replace,
      }),
    [navigate],
  );
  const currentDocumentsSearch = useMemo(
    () => documentsSearchFromState(view, filters),
    [filters, view],
  );

  const updateFilter = <Name extends keyof DocumentFilterValues,>(
    name: Name,
    value: DocumentFilterValues[Name],
  ) => {
    setSelectedIds([]);
    void navigateToDocumentsSearch(view, { ...filters, [name]: value }, true);
  };
  const filtersActive = hasDocumentFilter(documentFilter);
  const visibleDocuments = documents.data?.documents ?? EMPTY_DOCUMENT_LIST;
  const groupedVisibleDocuments = useMemo(
    () => groupDocumentsCanonically(visibleDocuments),
    [visibleDocuments],
  );
  const allDocuments = folderDocuments.data?.documents ?? visibleDocuments;
  const trashedItems = trashedDocuments.data?.documents ?? [];
  const hasDocuments = archiveHasDocuments || allDocuments.length > 0;
  const hasArchiveSurface = hasDocuments || trashedItems.length > 0;
  const personOptions = uniqueDocumentPersons(allDocuments);
  const tagOptions = uniqueDocumentTags(allDocuments);
  const savedSearchItems: SavedSearch[] = savedSearches.data?.savedSearches ?? [];
  const selectedDocuments = visibleDocuments.filter((document) =>
    selectedIds.includes(document.id),
  );
  const massSigningTargets = massSigningQueueTargets(visibleDocuments);
  const selectedTagOptions = uniqueDocumentTags(selectedDocuments);
  const visibleColumnIds = columnSettings.order.filter((column) =>
    columnSettings.visible.includes(column),
  );
  const bulkBusy = bulkProgress !== null;

  useEffect(() => {
    if (allDocuments.length > 0) setArchiveHasDocuments(true);
  }, [allDocuments.length]);

  useEffect(() => {
    setTextFilter(filters.text);
  }, [filters.text]);

  useEffect(() => {
    if (textFilter === filters.text) return;
    const timeout = window.setTimeout(() => {
      setSelectedIds([]);
      void navigateToDocumentsSearch(view, { ...filters, text: textFilter }, true);
    }, TEXT_FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [filters, navigateToDocumentsSearch, textFilter, view]);

  useEffect(() => {
    if (columnPreference.isSuccess) {
      setColumnSettings(
        normalizeDocumentColumnSettings(columnPreference.data.preference?.value),
      );
    }
  }, [columnPreference.data, columnPreference.isSuccess]);

  const clearFilters = () => {
    setSelectedIds([]);
    void navigateToDocumentsSearch(view, emptyDocumentFilters(), true);
  };

  const startMassSigning = () => {
    const [first, ...remaining] = massSigningTargets;
    if (!first) return;
    void navigate({
      to: '/app/documents/$id/sign/$fileId',
      params: { id: first.documentId, fileId: first.fileId },
      search: {
        ...currentDocumentsSearch,
        ...massSigningQueueSearch({
          signedCount: 0,
          skippedCount: 0,
          targets: remaining,
          total: massSigningTargets.length,
        }),
      },
    });
  };

  const saveColumnSettings = (settings: DocumentColumnSettings) => {
    setColumnSettings(settings);
    setColumnPreference.mutate({
      key: DOCUMENT_COLUMNS_KEY,
      input: { value: toColumnPreferenceValue(settings) },
    });
  };

  const setColumnVisible = (column: DocumentColumnId, visible: boolean) => {
    const nextVisible = visible
      ? Array.from(new Set([...columnSettings.visible, column]))
      : columnSettings.visible.filter((item) => item !== column);
    if (nextVisible.length === 0) return;
    saveColumnSettings({ ...columnSettings, visible: nextVisible });
  };

  const moveColumn = (column: DocumentColumnId, direction: -1 | 1) => {
    const index = columnSettings.order.indexOf(column);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= columnSettings.order.length) return;
    const order = [...columnSettings.order];
    const current = order[index];
    const next = order[target];
    if (!current || !next) return;
    order[index] = next;
    order[target] = current;
    saveColumnSettings({ ...columnSettings, order });
  };

  const openBulkDialog = (dialog: BulkDialog) => {
    setBulkSummary(null);
    setBulkDialog(dialog);
    if (dialog === 'add-tags') setBulkTags([]);
    if (dialog === 'remove-tag') setBulkRemoveTag(selectedTagOptions[0] ?? '');
    if (dialog === 'person') setBulkPerson('');
    if (dialog === 'type') setBulkDocType(selectedDocuments[0]?.docType ?? 'umowa-uod');
  };

  const runBulk = async (
    action: (document: DocumentWithFiles) => Promise<void>,
  ) => {
    if (selectedDocuments.length === 0 || bulkBusy) return;
    let changed = 0;
    let errors = 0;
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: selectedDocuments.length });
    for (const document of selectedDocuments) {
      try {
        await action(document);
        changed += 1;
      } catch {
        errors += 1;
      } finally {
        setBulkProgress((current) =>
          current ? { ...current, done: current.done + 1 } : current,
        );
      }
    }
    setBulkProgress(null);
    setBulkDialog(null);
    setBulkSummary({ changed, errors });
    setSelectedIds([]);
    await queryClient.invalidateQueries(actions.documentsInvalidates());
  };

  const closeRowMenu = () => {
    setRowMenuAnchor(null);
    setRowMenuDocument(null);
  };

  const moveOneToTrash = async (documentId: string) => {
    setBulkSummary(null);
    await bulkDeleteDocument.mutateAsync(documentId);
    await queryClient.invalidateQueries(actions.documentsInvalidates());
  };

  const saveCurrentSearch = () => {
    const name = savedSearchName.trim();
    if (!name || !filtersActive) return;
    createSavedSearch.mutate({ name, filter: documentFilter });
  };

  const applySavedSearch = (filter: SavedSearchFilter) => {
    setSelectedIds([]);
    void navigateToDocumentsSearch('list', toDocumentFilterValues(filter), false);
  };

  const runTrashAction = async (documentId: string, action: () => Promise<void>) => {
    setTrashError(null);
    setTrashBusyIds((current) =>
      current.includes(documentId) ? current : [...current, documentId],
    );
    try {
      await action();
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    } catch (error) {
      setTrashError(trashErrorMessage(error));
    } finally {
      setTrashBusyIds((current) => current.filter((id) => id !== documentId));
    }
  };

  const restoreFromTrash = (documentId: string) => {
    setTrashSummary(null);
    void runTrashAction(documentId, async () => {
      await restoreDocument.mutateAsync(documentId);
    });
  };

  const purgeFromTrash = (documentId: string) => {
    setTrashSummary(null);
    void runTrashAction(documentId, async () => {
      await purgeDocument.mutateAsync(documentId);
      setTrashConfirmDocument(null);
      setTrashSummary({ deleted: 1, errors: 0 });
    });
  };

  const emptyTrash = async () => {
    setTrashError(null);
    setTrashSummary(null);
    let deleted = 0;
    let errors = 0;
    for (const document of trashedItems) {
      setTrashBusyIds((current) =>
        current.includes(document.id) ? current : [...current, document.id],
      );
      try {
        await purgeDocument.mutateAsync(document.id);
        deleted += 1;
      } catch {
        errors += 1;
      } finally {
        setTrashBusyIds((current) => current.filter((id) => id !== document.id));
      }
    }
    setEmptyTrashOpen(false);
    setEmptyTrashConfirmation('');
    setTrashSummary({ deleted, errors });
    await queryClient.invalidateQueries(actions.documentsInvalidates());
  };

  const renderDocumentCell = (
    column: DocumentColumnId,
    document: DocumentWithFiles,
  ) => {
    if (column === 'documentDate') {
      return (
        <Typography variant="body2" color="text.secondary" noWrap>
          {formatPolishDate(document.documentDate)}
        </Typography>
      );
    }
    if (column === 'title') {
      return (
        <Typography variant="subtitle2" component="span">
          {document.title}
        </Typography>
      );
    }
    if (column === 'docType') {
      return (
        <Chip
          size="small"
          variant="outlined"
          label={DOCUMENT_TYPE_LABELS[document.docType]}
        />
      );
    }
    if (column === 'person') return document.person ?? '—';
    if (column === 'tags') {
      return document.tags.length > 0 ? (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
          {document.tags.map((tag) => (
            <Chip
              key={tag}
              size="small"
              label={tag}
              onClick={(event) => {
                event.stopPropagation();
                updateFilter('tag', tag);
              }}
            />
          ))}
        </Stack>
      ) : null;
    }
    if (column === 'period') {
      if (!document.periodStart && !document.periodEnd) return null;
      return `${document.periodStart ? formatPolishDate(document.periodStart) : '—'} - ${
        document.periodEnd ? formatPolishDate(document.periodEnd) : '—'
      }`;
    }
    if (column === 'signatureStatus') {
      const status = signedStatus(document);
      return (
        <Chip
          size="small"
          color={status === 'signed' ? 'success' : 'default'}
          variant="outlined"
          label={SIGNATURE_STATUS_LABELS[status]}
        />
      );
    }
    if (column === 'files') return <FileCounts files={document.files} />;
    return document.draft ? <Chip size="small" color="warning" label="Szkic" /> : null;
  };

  return (
    <PageContainer>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
      >
        <Box>
          <Typography variant="overline">Archiwum</Typography>
          <Typography variant="h1">Dokumenty</Typography>
        </Box>
        {hasArchiveSurface ? (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Dodaj dokument
          </Button>
        ) : null}
      </Stack>

      {hasArchiveSurface ? (
        <Tabs
          value={view}
          onChange={(_event, value: DocumentsView) => {
            if (value !== 'list') setSelectedIds([]);
            void navigateToDocumentsSearch(value, filters, false);
          }}
          sx={{ mt: 4 }}
        >
          <Tab value="list" label="Lista" />
          <Tab value="folders" label="Teczki" />
          <Tab value="timeline" label="Os czasu" />
          <Tab value="trash" label="Kosz" />
        </Tabs>
      ) : null}

      {search.podpisano !== undefined && search.razem !== undefined ? (
        <Alert severity="success" sx={{ mt: 3 }}>
          Podpisano {search.podpisano} z {search.razem}.
        </Alert>
      ) : null}

      {hasDocuments && view === 'list' ? <Paper variant="outlined" sx={{ mt: 3, p: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Szukaj po tytule"
            value={textFilter}
            onChange={(event) => setTextFilter(event.target.value)}
            sx={{ flex: { sm: '2 1 16rem' } }}
          />
          <FormControl sx={{ minWidth: '10rem', flex: { sm: '1 1 10rem' } }}>
            <InputLabel id="filter-document-type">Typ</InputLabel>
            <Select
              labelId="filter-document-type"
              label="Typ"
              value={filters.docType}
              onChange={(event) => {
                const value = String(event.target.value);
                updateFilter('docType', value === '' ? '' : documentTypeSchema.parse(value));
              }}
            >
              <MenuItem value="">Wszystkie</MenuItem>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Autocomplete
            freeSolo
            options={personOptions}
            value={filters.person}
            onChange={(_event, value) => updateFilter('person', value ?? '')}
            onInputChange={(_event, value) => updateFilter('person', value)}
            renderInput={(params) => <TextField {...params} label="Osoba" />}
            sx={{ flex: { sm: '1 1 10rem' } }}
          />
          <Autocomplete
            freeSolo
            options={tagOptions}
            value={filters.tag}
            onChange={(_event, value) => updateFilter('tag', value ?? '')}
            onInputChange={(_event, value) => updateFilter('tag', value)}
            renderInput={(params) => <TextField {...params} label="Tag" />}
            sx={{ flex: { sm: '1 1 10rem' } }}
          />
          <PolishDatePicker
            label="Od"
            value={filters.dateFrom}
            onChange={(value) => updateFilter('dateFrom', value)}
            sx={{ minWidth: '9.5rem', flex: { sm: '1 1 9.5rem' } }}
          />
          <PolishDatePicker
            label="Do"
            value={filters.dateTo}
            onChange={(value) => updateFilter('dateTo', value)}
            sx={{ minWidth: '9.5rem', flex: { sm: '1 1 9.5rem' } }}
          />
          <FormControl sx={{ minWidth: '11rem', flex: { sm: '1 1 11rem' } }}>
            <InputLabel id="filter-signature-status">Status podpisu</InputLabel>
            <Select
              labelId="filter-signature-status"
              label="Status podpisu"
              value={filters.signatureStatus}
              onChange={(event) => {
                const value = String(event.target.value);
                updateFilter(
                  'signatureStatus',
                  value === '' ? '' : documentSignatureStatusSchema.parse(value),
                );
              }}
            >
              <MenuItem value="">Wszystkie</MenuItem>
              {Object.entries(SIGNATURE_STATUS_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: '11rem', flex: { sm: '1 1 11rem' } }}>
            <InputLabel id="filter-draft">Szkice</InputLabel>
            <Select
              labelId="filter-draft"
              label="Szkice"
              value={filters.draft}
              onChange={(event) => {
                const value = String(event.target.value);
                updateFilter(
                  'draft',
                  value === 'true' || value === 'all' ? value : 'false',
                );
              }}
            >
              <MenuItem value="false">Tylko zatwierdzone</MenuItem>
              <MenuItem value="true">Tylko szkice</MenuItem>
              <MenuItem value="all">Wszystkie</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <Stack direction="row" sx={{ mt: 2, justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            disabled={!filtersActive}
            onClick={() => setSavedSearchOpen(true)}
          >
            Zapisz teczkę
          </Button>
        </Stack>
      </Paper> : null}

      {hasDocuments && view === 'folders' ? (
        <Box sx={{ mt: 3 }}>
          {savedSearches.isPending ? (
            <StatusView state={{ kind: 'loading', label: 'Ładowanie teczek…' }} />
          ) : null}
          {savedSearches.isError ? (
            <StatusView
              state={{
                kind: 'error',
                message: savedSearches.error.message,
                retry: {
                  label: 'Spróbuj ponownie',
                  onRetry: () => void savedSearches.refetch(),
                },
              }}
            />
          ) : null}
          {savedSearches.isSuccess && savedSearchItems.length === 0 ? (
            <StatusView
              state={{
                kind: 'empty',
                title: 'Brak teczek',
                body: 'Zapisz filtry z listy dokumentów.',
              }}
            />
          ) : null}
          {savedSearchItems.length > 0 ? (
            <Stack sx={{ gap: 2 }}>
              {savedSearchItems.map((savedSearch) => (
                <Card key={savedSearch.id} variant="outlined">
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
                  >
                    <CardActionArea onClick={() => applySavedSearch(savedSearch.filter)}>
                      <CardContent>
                        <Typography variant="h2">{savedSearch.name}</Typography>
                        <Typography variant="body2" sx={{ mt: 1 }}>
                          {documentFilterSummary(savedSearch.filter)}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                    <Stack
                      direction="row"
                      sx={{ gap: 1, p: 2, pt: { xs: 0, sm: 2 }, alignItems: 'center' }}
                    >
                      {confirmDeleteId === savedSearch.id ? (
                        <>
                          <Button
                            size="small"
                            color="error"
                            disabled={deleteSavedSearch.isPending}
                            onClick={() => deleteSavedSearch.mutate(savedSearch.id)}
                          >
                            Potwierdź
                          </Button>
                          <Button size="small" onClick={() => setConfirmDeleteId(null)}>
                            Anuluj
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setConfirmDeleteId(savedSearch.id)}
                        >
                          Usuń
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                </Card>
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {view === 'trash' ? (
        <Box sx={{ mt: 3 }}>
          {trashError ? <Alert severity="error">{trashError}</Alert> : null}
          {trashSummary ? (
            <Alert
              severity={trashSummary.errors > 0 ? 'warning' : 'success'}
              sx={{ mt: trashError ? 2 : 0 }}
            >
              Kosz: {trashSummary.deleted} usunięto, {trashSummary.errors} błędów.
            </Alert>
          ) : null}
          {trashedDocuments.isPending ? (
            <Box sx={{ mt: 3 }}>
              <StatusView state={{ kind: 'loading', label: 'Ładowanie kosza…' }} />
            </Box>
          ) : null}
          {trashedDocuments.isError ? (
            <Box sx={{ mt: 3 }}>
              <StatusView
                state={{
                  kind: 'error',
                  message: trashedDocuments.error.message,
                  retry: {
                    label: 'Spróbuj ponownie',
                    onRetry: () => void trashedDocuments.refetch(),
                  },
                }}
              />
            </Box>
          ) : null}
          {trashedDocuments.isSuccess && trashedItems.length === 0 ? (
            <Box sx={{ mt: 3 }}>
              <StatusView
                state={{
                  kind: 'empty',
                  title: 'Kosz jest pusty',
                  body: 'Kosz jest pusty. Kosz nigdy nie opróżnia się sam.',
                }}
              />
            </Box>
          ) : null}
          {trashedItems.length > 0 ? (
            <>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{
                  mt: 3,
                  alignItems: { xs: 'stretch', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 2,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Dokumenty w koszu można przywrócić albo usunąć trwale.
                </Typography>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={trashBusyIds.length > 0}
                  onClick={() => setEmptyTrashOpen(true)}
                >
                  Opróżnij kosz
                </Button>
              </Stack>
              <Stack sx={{ display: { xs: 'flex', sm: 'none' }, mt: 3, gap: 2 }}>
                {trashedItems.map((document) => {
                  const busy = trashBusyIds.includes(document.id);
                  return (
                    <Card key={document.id} variant="outlined">
                      <Stack direction="row" sx={{ alignItems: 'stretch' }}>
                        <CardActionArea
                          disabled={busy}
                          onClick={() =>
                            void navigate({
                              to: '/app/documents/$id',
                              params: { id: document.id },
                              search: currentDocumentsSearch,
                            })
                          }
                        >
                          <CardContent>
                            <Typography variant="h2">{document.title}</Typography>
                            <Stack
                              direction="row"
                              sx={{ mt: 1, gap: 0.75, flexWrap: 'wrap' }}
                            >
                              <Chip
                                size="small"
                                variant="outlined"
                                label={DOCUMENT_TYPE_LABELS[document.docType]}
                              />
                              <Chip
                                size="small"
                                variant="outlined"
                                label={`Usunięto: ${formatPolishDate(document.deletedAt ?? '')}`}
                              />
                            </Stack>
                            <Typography variant="body2" sx={{ mt: 1 }}>
                              {document.person ?? 'Bez przypisanej osoby'}
                            </Typography>
                          </CardContent>
                        </CardActionArea>
                      </Stack>
                      <Stack direction="row" sx={{ gap: 1, p: 2, pt: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={busy}
                          onClick={() => restoreFromTrash(document.id)}
                        >
                          Przywróć
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={busy}
                          onClick={() => setTrashConfirmDocument(document)}
                        >
                          Usuń trwale
                        </Button>
                      </Stack>
                      {busy ? (
                        <LinearProgress
                          aria-label={`Przetwarzanie dokumentu ${document.title}`}
                        />
                      ) : null}
                    </Card>
                  );
                })}
              </Stack>
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ display: { xs: 'none', sm: 'block' }, mt: 3 }}
              >
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Usunięto</TableCell>
                      <TableCell>Tytuł</TableCell>
                      <TableCell>Typ</TableCell>
                      <TableCell>Osoba</TableCell>
                      <TableCell align="right">Akcje</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trashedItems.map((document) => {
                      const busy = trashBusyIds.includes(document.id);
                      return (
                        <TableRow
                          key={document.id}
                          hover
                          onClick={() =>
                            void navigate({
                              to: '/app/documents/$id',
                              params: { id: document.id },
                              search: currentDocumentsSearch,
                            })
                          }
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {formatPolishDate(document.deletedAt ?? '')}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="subtitle2" component="span">
                              {document.title}
                            </Typography>
                            {busy ? (
                              <LinearProgress
                                aria-label={`Przetwarzanie dokumentu ${document.title}`}
                                sx={{ mt: 1 }}
                              />
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={DOCUMENT_TYPE_LABELS[document.docType]}
                            />
                          </TableCell>
                          <TableCell>{document.person ?? '—'}</TableCell>
                          <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                            <Stack
                              direction="row"
                              sx={{ gap: 1, justifyContent: 'flex-end' }}
                            >
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={busy}
                                onClick={() => restoreFromTrash(document.id)}
                              >
                                Przywróć
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                disabled={busy}
                                onClick={() => setTrashConfirmDocument(document)}
                              >
                                Usuń trwale
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : null}
        </Box>
      ) : null}

      {hasDocuments && view === 'list' ? <Stack
        direction="row"
        sx={{ mt: 3, alignItems: 'center', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}
      >
        {massSigningTargets.length > 0 ? (
          <Button
            variant="contained"
            disabled={bulkBusy}
            onClick={startMassSigning}
          >
            Masowe podpisywanie
          </Button>
        ) : null}
        <Button
          variant="outlined"
          onClick={(event) => setColumnsAnchor(event.currentTarget)}
        >
          Kolumny
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={selectedIds.length === 0 || bulkBusy}
          onClick={() =>
            void runBulk(async (document) => {
              await bulkDeleteDocument.mutateAsync(document.id);
            })
          }
        >
          Do kosza ({selectedIds.length})
        </Button>
        <Button
          variant="outlined"
          disabled={selectedIds.length === 0 || bulkBusy}
          onClick={() => openBulkDialog('add-tags')}
        >
          Dodaj tagi
        </Button>
        <Button
          variant="outlined"
          disabled={selectedIds.length === 0 || selectedTagOptions.length === 0 || bulkBusy}
          onClick={() => openBulkDialog('remove-tag')}
        >
          Usuń tag
        </Button>
        <Button
          variant="outlined"
          disabled={selectedIds.length === 0 || bulkBusy}
          onClick={() => openBulkDialog('person')}
        >
          Ustaw osobę
        </Button>
        <Button
          variant="outlined"
          disabled={selectedIds.length === 0 || bulkBusy}
          onClick={() => openBulkDialog('type')}
        >
          Ustaw typ
        </Button>
        <Button
          variant="outlined"
          disabled={selectedIds.length === 0 || exportDocuments.isPending || bulkBusy}
          onClick={() => exportDocuments.mutate({ documentIds: selectedIds })}
        >
          Eksportuj zaznaczone ({selectedIds.length})
        </Button>
      </Stack> : null}
      {bulkProgress ? (
        <Box sx={{ mt: 2 }}>
          <LinearProgress
            variant="determinate"
            value={(bulkProgress.done / bulkProgress.total) * 100}
            aria-label="Postęp operacji zbiorczej"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Przetworzono {bulkProgress.done} z {bulkProgress.total}.
          </Typography>
        </Box>
      ) : null}
      {bulkSummary ? (
        <Alert severity={bulkSummary.errors > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
          Operacje zbiorcze: {bulkSummary.changed} zmieniono, {bulkSummary.errors} błędów.
        </Alert>
      ) : null}
      <Popover
        open={Boolean(columnsAnchor)}
        anchorEl={columnsAnchor}
        onClose={() => setColumnsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2, width: '20rem', maxWidth: 'calc(100vw - 2rem)' }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1 }}>
            Kolumny
          </Typography>
          <FormGroup>
            {columnSettings.order.map((column, index) => {
              const checked = columnSettings.visible.includes(column);
              const onlyVisible = checked && columnSettings.visible.length === 1;
              return (
                <Stack
                  key={column}
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                >
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={checked}
                        disabled={onlyVisible}
                        onChange={(event) => setColumnVisible(column, event.target.checked)}
                      />
                    }
                    label={DOCUMENT_COLUMN_LABELS[column]}
                  />
                  <Stack direction="row" sx={{ gap: 0.25 }}>
                    <IconButton
                      size="small"
                      aria-label={`Przesuń w górę: ${DOCUMENT_COLUMN_LABELS[column]}`}
                      disabled={index === 0}
                      onClick={() => moveColumn(column, -1)}
                    >
                      <ArrowUpIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Przesuń w dół: ${DOCUMENT_COLUMN_LABELS[column]}`}
                      disabled={index === columnSettings.order.length - 1}
                      onClick={() => moveColumn(column, 1)}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                  </Stack>
                </Stack>
              );
            })}
          </FormGroup>
          {setColumnPreference.isPending ? (
            <Typography variant="caption" color="text.secondary">
              Zapisywanie…
            </Typography>
          ) : null}
          {setColumnPreference.isError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {setColumnPreference.error.message}
            </Alert>
          ) : null}
        </Box>
      </Popover>
      {exportDocuments.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>{exportDocuments.error.message}</Alert>
      ) : null}

      {(view === 'list' || view === 'timeline') && documents.isPending ? (
        <Box sx={{ mt: 4 }}>
          <StatusView state={{ kind: 'loading', label: 'Ładowanie dokumentów…' }} />
        </Box>
      ) : null}
      {(view === 'list' || view === 'timeline') && documents.isError ? (
        <Box sx={{ mt: 4 }}>
          <StatusView
            state={{
              kind: 'error',
              message: documents.error.message,
              retry: {
                label: 'Spróbuj ponownie',
                onRetry: () => void documents.refetch(),
              },
            }}
          />
        </Box>
      ) : null}
      {visibleDocuments.length === 0 &&
      filtersActive &&
      hasDocuments &&
      (view === 'list' || view === 'timeline') &&
      documents.isSuccess ? (
        <Box sx={{ mt: 4 }}>
          <StatusView
            state={{
              kind: 'empty',
              title: 'Brak wyników dla tych filtrów',
              action: (
                <Button variant="outlined" onClick={clearFilters}>
                  Wyczyść filtry
                </Button>
              ),
            }}
          />
        </Box>
      ) : null}
      {visibleDocuments.length === 0 &&
      !filtersActive &&
      (view === 'list' || view === 'timeline') &&
      documents.isSuccess ? (
        <Box sx={{ mt: 4 }}>
          <StatusView
            state={{
              kind: 'empty',
              title: 'Brak dokumentów',
              body: 'Dodaj pierwszy dokument do archiwum.',
              action: (
                <Button variant="contained" onClick={() => setCreateOpen(true)}>
                  Dodaj dokument
                </Button>
              ),
            }}
          />
        </Box>
      ) : null}
      {visibleDocuments.length > 0 && view === 'list' ? (
        <>
        <Stack sx={{ display: { xs: 'flex', sm: 'none' }, mt: 4, gap: 2 }}>
          {groupedVisibleDocuments.map((periodGroup) => (
            <Box key={`${periodGroup.start}|${periodGroup.end}`}>
              <Typography variant="h2" sx={{ mb: 1 }}>
                {formatCanonicalDocumentInterval(periodGroup)}
              </Typography>
              <Stack sx={{ gap: 1.5 }}>
                {periodGroup.people.map((personGroup) => (
                  <Box key={personGroup.person}>
                    <Typography variant="h3" color="text.secondary" sx={{ mb: 1 }}>
                      {personGroup.person}
                    </Typography>
                    <Stack sx={{ gap: 1.5 }}>
                      {personGroup.documents.map((document) => (
                        <Card key={document.id} variant="outlined">
                          <Stack direction="row" sx={{ alignItems: 'center' }}>
                            <Checkbox
                              slotProps={{
                                input: {
                                  'aria-label': `Zaznacz dokument: ${document.title}`,
                                },
                              }}
                              checked={selectedIds.includes(document.id)}
                              onChange={(event) =>
                                setSelectedIds((current) =>
                                  event.target.checked
                                    ? [...current, document.id]
                                    : current.filter((id) => id !== document.id),
                                )
                              }
                            />
                            <CardActionArea
                              onClick={() =>
                                void navigate({
                                  to: '/app/documents/$id',
                                  params: { id: document.id },
                                  search: currentDocumentsSearch,
                                })
                              }
                            >
                              <CardContent>
                                <Typography variant="h2">{document.title}</Typography>
                                {document.draft ? (
                                  <Chip size="small" color="warning" label="Szkic" sx={{ mt: 1 }} />
                                ) : null}
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                  {document.person ?? 'Bez przypisanej osoby'}
                                </Typography>
                                <Typography variant="body2">
                                  {formatPolishDate(document.documentDate)} · Pliki: {document.files.length}
                                </Typography>
                              </CardContent>
                            </CardActionArea>
                          </Stack>
                        </Card>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ display: { xs: 'none', sm: 'block' }, mt: 4 }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    slotProps={{
                      input: { 'aria-label': 'Zaznacz wszystkie dokumenty' },
                    }}
                    checked={visibleDocuments.every((document) =>
                      selectedIds.includes(document.id),
                    )}
                    indeterminate={
                      selectedIds.length > 0 &&
                      !visibleDocuments.every((document) =>
                        selectedIds.includes(document.id),
                      )
                    }
                    onChange={(event) =>
                      setSelectedIds(
                        event.target.checked
                          ? visibleDocuments.map((document) => document.id)
                          : [],
                      )
                    }
                  />
                </TableCell>
                {visibleColumnIds.map((column) => (
                  <TableCell key={column}>{DOCUMENT_COLUMN_LABELS[column]}</TableCell>
              ))}
                <TableCell align="right">Akcje</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groupedVisibleDocuments.flatMap((periodGroup) => [
                <TableRow key={`${periodGroup.start}|${periodGroup.end}`}>
                  <TableCell
                    colSpan={visibleColumnIds.length + 2}
                    sx={{ py: 1.25 }}
                  >
                    <Typography variant="h3">
                      {formatCanonicalDocumentInterval(periodGroup)}
                    </Typography>
                  </TableCell>
                </TableRow>,
                ...periodGroup.people.flatMap((personGroup) => [
                  <TableRow key={`${periodGroup.start}|${periodGroup.end}|${personGroup.person}`}>
                    <TableCell
                      colSpan={visibleColumnIds.length + 2}
                      sx={{ py: 1, pl: 4 }}
                    >
                      <Typography variant="subtitle2" color="text.secondary">
                        {personGroup.person}
                      </Typography>
                    </TableCell>
                  </TableRow>,
                  ...personGroup.documents.map((document) => (
                    <TableRow
                      key={document.id}
                      hover
                      onClick={() =>
                        void navigate({
                          to: '/app/documents/$id',
                          params: { id: document.id },
                          search: currentDocumentsSearch,
                        })
                      }
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell
                        padding="checkbox"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          slotProps={{
                            input: {
                              'aria-label': `Zaznacz dokument: ${document.title}`,
                            },
                          }}
                          checked={selectedIds.includes(document.id)}
                          onChange={(event) =>
                            setSelectedIds((current) =>
                              event.target.checked
                                ? [...current, document.id]
                                : current.filter((id) => id !== document.id),
                            )
                          }
                        />
                      </TableCell>
                      {visibleColumnIds.map((column) => (
                        <TableCell key={column}>{renderDocumentCell(column, document)}</TableCell>
                      ))}
                      <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                        <IconButton
                          size="small"
                          aria-label={`Więcej akcji dla dokumentu ${document.title}`}
                          onClick={(event) => {
                            setRowMenuAnchor(event.currentTarget);
                            setRowMenuDocument(document);
                          }}
                        >
                          <MoreVertIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )),
                ]),
              ])}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      ) : null}

      {visibleDocuments.length > 0 && view === 'timeline' ? (
        <DocumentTimelineView
          documents={visibleDocuments}
          onOpenDocument={(id) =>
            void navigate({
              to: '/app/documents/$id',
              params: { id },
              search: currentDocumentsSearch,
            })
          }
        />
      ) : null}

      <Menu
        anchorEl={rowMenuAnchor}
        open={Boolean(rowMenuAnchor)}
        onClose={closeRowMenu}
      >
        <MenuItem
          onClick={() => {
            const document = rowMenuDocument;
            closeRowMenu();
            if (!document) return;
            void navigate({
              to: '/app/documents/$id',
              params: { id: document.id },
              search: currentDocumentsSearch,
            });
          }}
        >
          Otwórz
        </MenuItem>
        <MenuItem
          onClick={() => {
            const document = rowMenuDocument;
            closeRowMenu();
            if (!document) return;
            void moveOneToTrash(document.id);
          }}
        >
          <Typography color="error">Do kosza</Typography>
        </MenuItem>
      </Menu>

      <Dialog
        open={bulkDialog !== null}
        onClose={bulkBusy ? undefined : () => setBulkDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {bulkDialog === 'add-tags'
            ? 'Dodaj tagi'
            : bulkDialog === 'remove-tag'
              ? 'Usuń tag'
              : bulkDialog === 'person'
                ? 'Ustaw osobę'
                : 'Ustaw typ'}
        </DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            {bulkDialog === 'add-tags' ? (
              <Autocomplete
                multiple
                freeSolo
                options={tagOptions}
                value={bulkTags}
                onChange={(_event, value) => setBulkTags(value)}
                renderInput={(params) => <TextField {...params} label="Tagi" />}
              />
            ) : null}
            {bulkDialog === 'remove-tag' ? (
              <FormControl fullWidth>
                <InputLabel id="bulk-remove-tag-label">Tag</InputLabel>
                <Select
                  labelId="bulk-remove-tag-label"
                  label="Tag"
                  value={bulkRemoveTag}
                  onChange={(event) => setBulkRemoveTag(String(event.target.value))}
                >
                  {selectedTagOptions.map((tag) => (
                    <MenuItem key={tag} value={tag}>
                      {tag}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {bulkDialog === 'person' ? (
              <>
                <Alert severity="warning">
                  Nadpiszesz osobę w {selectedDocuments.length} dokumentach.
                </Alert>
                <Autocomplete
                  freeSolo
                  options={personOptions}
                  value={bulkPerson}
                  onChange={(_event, value) => setBulkPerson(value ?? '')}
                  onInputChange={(_event, value) => setBulkPerson(value)}
                  renderInput={(params) => <TextField {...params} label="Osoba" />}
                />
              </>
            ) : null}
            {bulkDialog === 'type' ? (
              <>
                <Alert severity="warning">
                  Nadpiszesz typ w {selectedDocuments.length} dokumentach.
                </Alert>
                <FormControl fullWidth>
                  <InputLabel id="bulk-document-type-label">Typ</InputLabel>
                  <Select
                    labelId="bulk-document-type-label"
                    label="Typ"
                    value={bulkDocType}
                    onChange={(event) =>
                      setBulkDocType(documentTypeSchema.parse(event.target.value))
                    }
                  >
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={bulkBusy} onClick={() => setBulkDialog(null)}>
            Anuluj
          </Button>
          <Button
            variant="contained"
            disabled={
              bulkBusy ||
              selectedDocuments.length === 0 ||
              (bulkDialog === 'add-tags' && bulkTags.map((tag) => tag.trim()).filter(Boolean).length === 0) ||
              (bulkDialog === 'remove-tag' && !bulkRemoveTag) ||
              (bulkDialog === 'person' && bulkPerson.trim().length === 0)
            }
            onClick={() => {
              if (bulkDialog === 'add-tags') {
                const tags = bulkTags.map((tag) => tag.trim()).filter(Boolean);
                void runBulk(async (document) => {
                  await bulkUpdateDocument.mutateAsync({
                    documentId: document.id,
                    input: toUpdateDocumentInput(document, {
                      tags: Array.from(new Set([...document.tags, ...tags])),
                    }),
                  });
                });
                return;
              }
              if (bulkDialog === 'remove-tag') {
                void runBulk(async (document) => {
                  await bulkUpdateDocument.mutateAsync({
                    documentId: document.id,
                    input: toUpdateDocumentInput(document, {
                      tags: document.tags.filter((tag) => tag !== bulkRemoveTag),
                    }),
                  });
                });
                return;
              }
              if (bulkDialog === 'person') {
                const person = bulkPerson.trim();
                void runBulk(async (document) => {
                  await bulkUpdateDocument.mutateAsync({
                    documentId: document.id,
                    input: toUpdateDocumentInput(document, { person }),
                  });
                });
                return;
              }
              if (bulkDialog === 'type') {
                void runBulk(async (document) => {
                  await bulkUpdateDocument.mutateAsync({
                    documentId: document.id,
                    input: toUpdateDocumentInput(document, { docType: bulkDocType }),
                  });
                });
              }
            }}
          >
            Zastosuj
          </Button>
        </DialogActions>
      </Dialog>

      <DocumentFormDialog
        open={createOpen}
        title="Dodaj dokument"
        submitLabel="Dodaj dokument"
        pending={createDocument.isPending}
        error={createDocument.error?.message}
        personOptions={personOptions}
        tagOptions={tagOptions}
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createDocument.mutate(toDocumentInput(values))}
      />
      <Dialog
        open={savedSearchOpen}
        onClose={() => setSavedSearchOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Zapisz teczkę</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Nazwa"
            value={savedSearchName}
            onChange={(event) => setSavedSearchName(event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <Typography variant="body2" sx={{ mt: 2 }}>
            {documentFilterSummary(documentFilter)}
          </Typography>
          {createSavedSearch.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>{createSavedSearch.error.message}</Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSavedSearchOpen(false)}>Anuluj</Button>
          <Button
            variant="contained"
            disabled={!savedSearchName.trim() || createSavedSearch.isPending}
            onClick={saveCurrentSearch}
          >
            Zapisz teczkę
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(trashConfirmDocument)}
        onClose={() => setTrashConfirmDocument(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Usunąć trwale?</DialogTitle>
        <DialogContent>
          <Typography>
            Dokument „{trashConfirmDocument?.title ?? ''}” i wszystkie jego pliki
            zostaną trwale usunięte z magazynu blob. Tej operacji nie można
            cofnąć.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrashConfirmDocument(null)}>Anuluj</Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              !trashConfirmDocument ||
              trashBusyIds.includes(trashConfirmDocument.id)
            }
            onClick={() => {
              if (trashConfirmDocument) purgeFromTrash(trashConfirmDocument.id);
            }}
          >
            Usuń trwale
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={emptyTrashOpen}
        onClose={() => {
          setEmptyTrashOpen(false);
          setEmptyTrashConfirmation('');
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Opróżnić kosz?</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <Typography>
              Wszystkie dokumenty widoczne w koszu i ich pliki zostaną trwale
              usunięte z magazynu blob. Tej operacji nie można cofnąć.
            </Typography>
            <TextField
              label={`Wpisz ${TRASH_EMPTY_CONFIRMATION}`}
              value={emptyTrashConfirmation}
              onChange={(event) => setEmptyTrashConfirmation(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={trashBusyIds.length > 0}
            onClick={() => {
              setEmptyTrashOpen(false);
              setEmptyTrashConfirmation('');
            }}
          >
            Anuluj
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              emptyTrashConfirmation !== TRASH_EMPTY_CONFIRMATION ||
              trashedItems.length === 0 ||
              trashBusyIds.length > 0
            }
            onClick={() => void emptyTrash()}
          >
            Opróżnij kosz
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};
