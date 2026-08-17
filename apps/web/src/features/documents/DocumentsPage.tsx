import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  SvgIcon,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLink, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';
import {
  documentSignatureStatusSchema,
  documentTypeSchema,
  selectableDocumentTypes,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  visibleFilterValues,
  type DocumentListItem,
  type DocumentTypeSlug,
  type DocumentWithFiles,
  type UpdateDocument,
  type UserPreferenceValue,
} from '#core/domain/index.js';

import { actions, preferenceActions, savedSearchActions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { PolishDatePicker } from '../../components/ui/PolishDatePicker.js';
import { formatPolishDate } from '../../lib/format-date.js';
import {
  DOCUMENTS_TABLE_HEAD_HEIGHT,
  DocumentColumnHeadCell,
  DocumentMetadataCell,
  DocumentMetadataText,
  DocumentPersonTableCell,
  DocumentPersonTitle,
  DocumentPeriodTableCell,
  DocumentPeriodTitle,
  DocumentRecordTitleCell,
  DocumentsTable,
  DocumentsTableContainer,
  DocumentTitleText,
} from '../../theme.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import { PendingDraftsDot } from './PendingDraftsDot.js';
import {
  FILE_ROLE_LABELS,
  FILE_ROLE_SHORT_LABELS,
  SIGNATURE_STATUS_LABELS,
  documentFiltersFromSearch,
  documentFilterSummary,
  documentTypeLabel,
  documentsSearchFromState,
  documentsViewFromSearch,
  emptyDocumentFilters,
  formatCanonicalDocumentInterval,
  groupDocumentsCanonically,
  hasSignedDocumentFile,
  hasDocumentFilter,
  massReviewQueueDocumentIds,
  massReviewQueueSearch,
  massSigningQueueSearch,
  massSigningQueueTargets,
  toDocumentFilter,
  toDocumentInput,
  type DocumentsView,
  type DocumentFilterValues,
} from './documents.logic.js';

const LazyDocumentTimelineView = lazy(() =>
  import('./DocumentTimelineView.js').then((module) => ({
    default: module.DocumentTimelineView,
  })),
);

const FileCounts = ({ files }: { files: Array<{ role: string }> }) => {
  const present = (['source', 'signed-scan', 'signed-digital', 'other'] as const)
    .map((role) => ({
      role,
      count: files.filter((file) => file.role === role).length,
    }))
    .filter(({ count }) => count > 0);
  if (present.length === 0) {
    return (
      <DocumentMetadataText>
        Brak plików
      </DocumentMetadataText>
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

const CloseIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4l-6.3 6.31-1.42-1.42L9.17 12l-6.3-6.29 1.42-1.42 6.3 6.31 6.3-6.31 1.41 1.42Z" />
  </SvgIcon>
);

const RouterCardActionArea = createLink(CardActionArea);
const RouterMenuItem = createLink(MenuItem);

const DOCUMENT_COLUMNS_KEY = 'documents.columns';
const TEXT_FILTER_DEBOUNCE_MS = 300;
const EMPTY_DOCUMENT_LIST: DocumentListItem[] = [];

const DOCUMENT_COLUMN_IDS = [
  'documentDate',
  'docType',
  'person',
  'tags',
  'period',
  'signatureStatus',
  'signers',
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
  docType: 'Typ',
  person: 'Strona',
  tags: 'Tagi',
  period: 'Okres',
  signatureStatus: 'Status podpisu',
  signers: 'Podpisali',
  files: 'Pliki',
  draft: 'Szkic',
};

const documentColumnPreferenceSchema = z.object({
  version: z.literal(2).optional(),
  order: z.array(z.string()),
  visible: z.array(z.string()),
});

const defaultDocumentColumnSettings = (): DocumentColumnSettings => ({
  order: Array.from(DOCUMENT_COLUMN_IDS),
  visible: ['documentDate', 'docType', 'person', 'signers', 'files', 'draft'],
});

const normalizeDocumentColumnSettings = (value: unknown): DocumentColumnSettings => {
  const fallback = defaultDocumentColumnSettings();
  const parsed = documentColumnPreferenceSchema.safeParse(value);
  if (!parsed.success) return fallback;
  const known = new Set<string>(DOCUMENT_COLUMN_IDS);
  const isKnownColumn = (column: string): column is DocumentColumnId => known.has(column);
  const order = [
    ...parsed.data.order.filter(isKnownColumn),
    ...DOCUMENT_COLUMN_IDS.filter((column) => !parsed.data.order.includes(column)),
  ];
  const visible = [
    ...parsed.data.visible.filter(isKnownColumn),
    ...(parsed.data.version === 2 || parsed.data.visible.includes('signers')
      ? []
      : ['signers' as const]),
  ];
  return {
    order,
    visible: visible.length > 0 ? visible : fallback.visible,
  };
};

const toColumnPreferenceValue = (
  settings: DocumentColumnSettings,
): UserPreferenceValue => ({
  version: 2,
  order: settings.order,
  visible: settings.visible,
});

const signedStatus = (document: DocumentWithFiles) =>
  hasSignedDocumentFile(document)
    ? 'signed'
    : document.signatureNotRequired
      ? 'not-required'
      : 'needs-signature';

const signerInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/u);
  const selected = parts.length > 1 ? [parts[0], parts.at(-1)] : parts;
  return selected
    .map((part) => Array.from(part ?? '')[0]?.toLocaleUpperCase('pl-PL') ?? '')
    .join('');
};

type BulkDialog = 'add-tags' | 'link' | 'remove-tag' | 'person' | 'type';

interface BulkSummary {
  changed: number;
  errors: number;
  skipped: number;
  kind:
    | 'approved'
    | 'changed'
    | 'linked'
    | 'proposals-approved'
    | 'required'
    | 'unapproved'
    | 'waived';
}

const bulkSummaryMessage = (summary: BulkSummary): string => {
  if (summary.kind === 'approved') {
    return `Zatwierdzono ${summary.changed}, błędów ${summary.errors}.`;
  }
  if (summary.kind === 'proposals-approved') {
    const documents = summary.changed === 1 ? 'w 1 dokumencie' : `w ${summary.changed} dokumentach`;
    return `Zatwierdzono propozycje ${documents}, pominięto ${summary.skipped}.`;
  }
  if (summary.kind === 'unapproved') {
    return `Cofnięto do szkicu ${summary.changed}, błędów ${summary.errors}.`;
  }
  if (summary.kind === 'waived') {
    return `Oznaczono jako niewymagające podpisu ${summary.changed}, błędów ${summary.errors}.`;
  }
  if (summary.kind === 'required') {
    return `Przywrócono wymaganie podpisu ${summary.changed}, błędów ${summary.errors}.`;
  }
  if (summary.kind === 'linked') {
    return `Powiązano ${summary.changed}, pominięto ${summary.skipped}, błędów ${summary.errors}.`;
  }
  return `Operacje zbiorcze: ${summary.changed} zmieniono, ${summary.errors} błędów.`;
};

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDialog, setBulkDialog] = useState<BulkDialog | null>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkRemoveTag, setBulkRemoveTag] = useState('');
  const [bulkPerson, setBulkPerson] = useState('');
  const [bulkDocType, setBulkDocType] = useState<DocumentTypeSlug>('');
  const [bulkLinkSearch, setBulkLinkSearch] = useState('');
  const [bulkLinkTargetId, setBulkLinkTargetId] = useState('');
  const [bulkLinkLabel, setBulkLinkLabel] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<BulkSummary | null>(null);
  const [bulkMenuAnchor, setBulkMenuAnchor] = useState<HTMLElement | null>(null);
  const [approveProposalsOpen, setApproveProposalsOpen] = useState(false);
  const [rowMenuAnchor, setRowMenuAnchor] = useState<HTMLElement | null>(null);
  const [rowMenuDocument, setRowMenuDocument] = useState<DocumentListItem | null>(null);
  const [columnSettings, setColumnSettings] = useState<DocumentColumnSettings>(
    defaultDocumentColumnSettings,
  );
  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  const view = useMemo(() => documentsViewFromSearch(search), [search]);
  const filters = useMemo(() => documentFiltersFromSearch(search), [search]);
  const [textFilter, setTextFilter] = useState(filters.text);
  const documentFilter = toDocumentFilter(filters);
  const documents = useQuery(actions.documents(documentFilter));
  const documentTypes = useQuery(actions.documentTypes);
  const hiddenFilterValues = useQuery(actions.hiddenFilterValues);
  const folderDocuments = useQuery(actions.documents({ draft: 'all' }));
  const tenantAccounts = useQuery(actions.tenantAccounts);
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
  const bulkApproveDocument = useMutation(actions.approveDocument);
  const bulkApproveProposals = useMutation(actions.bulkApproveDocumentMetadataProposals);
  const bulkUnapproveDocument = useMutation(actions.unapproveDocument);
  const bulkWaiveDocumentSignature = useMutation(actions.waiveDocumentSignature);
  const bulkRequireDocumentSignature = useMutation(actions.requireDocumentSignature);
  const bulkLinkDocuments = useMutation(actions.linkDocuments);
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
  const typeOptions = documentTypes.data?.documentTypes ?? [];
  const filterTypeOptions = selectableDocumentTypes(typeOptions, filters.docType);
  const groupedVisibleDocuments = useMemo(
    () => groupDocumentsCanonically(visibleDocuments),
    [visibleDocuments],
  );
  const allDocuments = folderDocuments.data?.documents ?? visibleDocuments;
  const hasDocuments = allDocuments.length > 0;
  const hiddenValues = hiddenFilterValues.data?.hiddenFilterValues ?? [];
  const personOptions = visibleFilterValues(
    uniqueDocumentPersons(allDocuments),
    hiddenValues,
    'person',
  );
  const tagOptions = visibleFilterValues(uniqueDocumentTags(allDocuments), hiddenValues, 'tag');
  const signerOptions = tenantAccounts.data?.accounts ?? [];
  const selectedDocuments = visibleDocuments.filter((document) =>
    selectedIds.includes(document.id),
  );
  const selectedDraftDocuments = selectedDocuments.filter((document) => document.draft);
  const selectedApprovedDocuments = selectedDocuments.filter((document) => !document.draft);
  const selectedSignatureRequiredDocuments = selectedDocuments.filter(
    (document) => !document.signatureNotRequired,
  );
  const selectedSignatureWaivedDocuments = selectedDocuments.filter(
    (document) => document.signatureNotRequired,
  );
  const selectedProposalDocuments = selectedDocuments.filter(
    (document) => (document.pendingDrafts?.metadataProposals ?? 0) > 0,
  );
  const massReviewDocumentIds = massReviewQueueDocumentIds(selectedDocuments);
  const massSigningTargets = massSigningQueueTargets(selectedDocuments);
  const selectedTagOptions = uniqueDocumentTags(selectedDocuments);
  const normalizedBulkLinkSearch = bulkLinkSearch.trim().toLocaleLowerCase('pl');
  const bulkLinkCandidates = allDocuments.filter((candidate) =>
    candidate.title.toLocaleLowerCase('pl').includes(normalizedBulkLinkSearch),
  );
  const visibleColumnIds = columnSettings.order.filter((column) =>
    columnSettings.visible.includes(column),
  );
  const bulkBusy = bulkProgress !== null || bulkApproveProposals.isPending;

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

  const startMassReview = () => {
    const first = massReviewDocumentIds[0];
    if (!first) return;
    void navigate({
      to: '/app/documents/$id/review',
      params: { id: first },
      search: {
        ...currentDocumentsSearch,
        ...massReviewQueueSearch(massReviewDocumentIds),
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
    setBulkMenuAnchor(null);
    setBulkSummary(null);
    setBulkDialog(dialog);
    if (dialog === 'add-tags') setBulkTags([]);
    if (dialog === 'remove-tag') setBulkRemoveTag(selectedTagOptions[0] ?? '');
    if (dialog === 'person') setBulkPerson('');
    if (dialog === 'type') {
      setBulkDocType(selectedDocuments[0]?.docType ?? typeOptions[0]?.slug ?? '');
    }
    if (dialog === 'link') {
      setBulkLinkSearch('');
      setBulkLinkTargetId('');
      setBulkLinkLabel('');
    }
  };

  const approveSelectedProposals = async () => {
    if (selectedIds.length === 0 || bulkBusy) return;
    const documentIds = [...selectedIds];
    let result: { approved: number; skipped: number };
    try {
      result = await bulkApproveProposals.mutateAsync({ documentIds });
    } catch {
      return;
    }
    setApproveProposalsOpen(false);
    setBulkSummary({
      changed: result.approved,
      errors: 0,
      skipped: result.skipped,
      kind: 'proposals-approved',
    });
    setSelectedIds([]);
    await Promise.all([
      queryClient.invalidateQueries(actions.documentsInvalidates()),
      ...documentIds.map((documentId) =>
        queryClient.invalidateQueries(
          actions.documentMetadataProposalsInvalidates(documentId),
        ),
      ),
    ]);
  };

  const runBulk = async (
    action: (document: DocumentWithFiles) => Promise<unknown>,
    options?: {
      documents?: DocumentWithFiles[];
      summaryKind?: BulkSummary['kind'];
    },
  ) => {
    const targets = options?.documents ?? selectedDocuments;
    if (targets.length === 0 || bulkBusy) return;
    let changed = 0;
    let errors = 0;
    let skipped = 0;
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: targets.length });
    for (const document of targets) {
      try {
        const outcome = await action(document);
        if (outcome === 'skipped') skipped += 1;
        else changed += 1;
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
    setBulkSummary({ changed, errors, skipped, kind: options?.summaryKind ?? 'changed' });
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

  const renderDocumentCell = (
    column: DocumentColumnId,
    document: DocumentListItem,
  ) => {
    if (column === 'documentDate') {
      return (
        <DocumentMetadataText noWrap>
          {formatPolishDate(document.documentDate)}
        </DocumentMetadataText>
      );
    }
    if (column === 'docType') {
      return (
        <Chip
          size="small"
          variant="outlined"
          label={documentTypeLabel(typeOptions, document.docType)}
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
          label={status === 'not-required' ? 'Nie wymaga' : SIGNATURE_STATUS_LABELS[status]}
        />
      );
    }
    if (column === 'signers') {
      return document.signers.length > 0 ? (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
          {document.signers.map((signer) => (
            <Tooltip key={signer.accountId} title={signer.name} describeChild disableInteractive>
              <Chip
                size="small"
                variant="outlined"
                label={signerInitials(signer.name)}
                aria-label={signer.name}
              />
            </Tooltip>
          ))}
        </Stack>
      ) : null;
    }
    if (column === 'files') return <FileCounts files={document.files} />;
    return document.draft ? (
      <Chip size="small" color="warning" variant="outlined" label="Szkic" />
    ) : null;
  };

  return (
    <PageContainer wide>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
      >
        <Box>
          <Typography variant="overline">Archiwum</Typography>
          <Typography variant="h1">Dokumenty</Typography>
        </Box>
        {hasDocuments ? (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Dodaj dokument
          </Button>
        ) : null}
      </Stack>

      {search.podpisano !== undefined && search.razem !== undefined ? (
        <Alert severity="success" sx={{ mt: 3 }}>
          Podpisano {search.podpisano} z {search.razem}.
        </Alert>
      ) : null}

      {hasDocuments ? <Paper variant="outlined" sx={{ mt: 3, p: 2.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 2, flexWrap: 'wrap', '& > *': { maxWidth: { sm: '22rem' } } }}
        >
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
              {filterTypeOptions.map((documentType) => (
                <MenuItem key={documentType.slug} value={documentType.slug}>
                  {documentType.label}
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
            renderInput={(params) => <TextField {...params} label="Strona" />}
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
                  value === 'true' || value === 'all' || value === 'pending'
                    ? value
                    : 'false',
                );
              }}
            >
              <MenuItem value="false">Tylko zatwierdzone</MenuItem>
              <MenuItem value="true">Tylko szkice</MenuItem>
              <MenuItem value="pending">Z niezatwierdzonymi zmianami</MenuItem>
              <MenuItem value="all">Wszystkie</MenuItem>
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: '11rem', flex: { sm: '1 1 11rem' } }}>
            <InputLabel id="filter-signer-account">Podpisał(a)</InputLabel>
            <Select
              labelId="filter-signer-account"
              label="Podpisał(a)"
              value={filters.signerAccountId}
              onChange={(event) => updateFilter('signerAccountId', String(event.target.value))}
            >
              <MenuItem value="">Wszyscy</MenuItem>
              {signerOptions.map((tenantAccount) => (
                <MenuItem key={tenantAccount.accountId} value={tenantAccount.accountId}>
                  {tenantAccount.name}
                </MenuItem>
              ))}
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

      {hasDocuments ? (
        <Stack sx={{ mt: 3, gap: 1 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              aria-label="Widok dokumentów"
              onChange={(_event, value: DocumentsView | null) => {
                if (!value) return;
                if (value === 'timeline') setSelectedIds([]);
                void navigateToDocumentsSearch(value, filters, false);
              }}
            >
              <ToggleButton value="list">Lista</ToggleButton>
              <ToggleButton value="timeline">Oś czasu</ToggleButton>
            </ToggleButtonGroup>
            {view === 'list' ? (
              <Button
                variant="outlined"
                onClick={(event) => setColumnsAnchor(event.currentTarget)}
              >
                Kolumny
              </Button>
            ) : null}
          </Stack>
          {view === 'list' && selectedIds.length > 0 ? (
            <Paper variant="outlined">
              <Toolbar
                role="toolbar"
                aria-label="Akcje zaznaczonych dokumentów"
                variant="dense"
                sx={{ minHeight: 56, gap: 1, flexWrap: 'wrap', py: 1 }}
              >
                <Typography sx={{ mr: 1 }}>Zaznaczono: {selectedIds.length}</Typography>
                <Button
                  variant="contained"
                  disabled={massSigningTargets.length === 0 || bulkBusy}
                  onClick={startMassSigning}
                >
                  Masowe podpisywanie ({massSigningTargets.length})
                </Button>
                <Button
                  variant="contained"
                  disabled={selectedDocuments.length === 0 || bulkBusy}
                  onClick={startMassReview}
                >
                  Masowe przeglądanie ({selectedDocuments.length})
                </Button>
                <Button
                  variant="contained"
                  disabled={selectedDraftDocuments.length === 0 || bulkBusy}
                  onClick={() =>
                    void runBulk(
                      async (document) => {
                        await bulkApproveDocument.mutateAsync(document.id);
                      },
                      { documents: selectedDraftDocuments, summaryKind: 'approved' },
                    )
                  }
                >
                  Zatwierdź ({selectedDraftDocuments.length})
                </Button>
                <Button
                  variant="outlined"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(bulkMenuAnchor)}
                  disabled={bulkBusy}
                  onClick={(event) => setBulkMenuAnchor(event.currentTarget)}
                >
                  Więcej
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <IconButton
                  aria-label="Wyczyść zaznaczenie"
                  disabled={bulkBusy}
                  onClick={() => setSelectedIds([])}
                >
                  <CloseIcon />
                </IconButton>
              </Toolbar>
            </Paper>
          ) : null}
        </Stack>
      ) : null}
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
          {bulkSummaryMessage(bulkSummary)}
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
      <Menu
        anchorEl={bulkMenuAnchor}
        open={Boolean(bulkMenuAnchor)}
        onClose={() => setBulkMenuAnchor(null)}
      >
        <MenuItem
          disabled={selectedProposalDocuments.length === 0 || bulkBusy}
          onClick={() => {
            setBulkMenuAnchor(null);
            setApproveProposalsOpen(true);
          }}
        >
          Zatwierdź propozycje ({selectedProposalDocuments.length})
        </MenuItem>
        <MenuItem
          disabled={selectedSignatureRequiredDocuments.length === 0 || bulkBusy}
          onClick={() => {
            setBulkMenuAnchor(null);
            void runBulk(
              async (document) => {
                await bulkWaiveDocumentSignature.mutateAsync(document.id);
              },
              {
                documents: selectedSignatureRequiredDocuments,
                summaryKind: 'waived',
              },
            );
          }}
        >
          Nie wymaga podpisu ({selectedSignatureRequiredDocuments.length})
        </MenuItem>
        {selectedSignatureWaivedDocuments.length > 0 ? (
          <MenuItem
            disabled={bulkBusy}
            onClick={() => {
              setBulkMenuAnchor(null);
              void runBulk(
                async (document) => {
                  await bulkRequireDocumentSignature.mutateAsync(document.id);
                },
                {
                  documents: selectedSignatureWaivedDocuments,
                  summaryKind: 'required',
                },
              );
            }}
          >
            Wymaga podpisu ({selectedSignatureWaivedDocuments.length})
          </MenuItem>
        ) : null}
        {selectedApprovedDocuments.length > 0 ? (
          <MenuItem
            disabled={bulkBusy}
            onClick={() => {
              setBulkMenuAnchor(null);
              void runBulk(
                async (document) => {
                  await bulkUnapproveDocument.mutateAsync(document.id);
                },
                { documents: selectedApprovedDocuments, summaryKind: 'unapproved' },
              );
            }}
          >
            Cofnij do szkicu ({selectedApprovedDocuments.length})
          </MenuItem>
        ) : null}
        <Divider />
        <MenuItem disabled={bulkBusy} onClick={() => openBulkDialog('add-tags')}>
          Dodaj tagi
        </MenuItem>
        <MenuItem
          disabled={selectedTagOptions.length === 0 || bulkBusy}
          onClick={() => openBulkDialog('remove-tag')}
        >
          Usuń tag
        </MenuItem>
        <MenuItem disabled={bulkBusy} onClick={() => openBulkDialog('person')}>
          Ustaw stronę
        </MenuItem>
        <MenuItem disabled={bulkBusy} onClick={() => openBulkDialog('type')}>
          Ustaw typ
        </MenuItem>
        <MenuItem disabled={bulkBusy} onClick={() => openBulkDialog('link')}>
          Powiąż z dokumentem… ({selectedIds.length})
        </MenuItem>
        <MenuItem
          disabled={exportDocuments.isPending || bulkBusy}
          onClick={() => {
            setBulkMenuAnchor(null);
            exportDocuments.mutate({ documentIds: selectedIds });
          }}
        >
          Eksportuj zaznaczone ({selectedIds.length})
        </MenuItem>
        <Divider />
        <MenuItem
          disabled={bulkBusy}
          onClick={() => {
            setBulkMenuAnchor(null);
            void runBulk(async (document) => {
              await bulkDeleteDocument.mutateAsync(document.id);
            });
          }}
        >
          <Typography color="error">Do kosza ({selectedIds.length})</Typography>
        </MenuItem>
      </Menu>
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
                            <RouterCardActionArea
                              to="/app/documents/$id"
                              params={{ id: document.id }}
                              search={currentDocumentsSearch}
                            >
                              <CardContent>
                                <Typography
                                  variant="h2"
                                  sx={{ display: 'flex', alignItems: 'center' }}
                                >
                                  <PendingDraftsDot counts={document.pendingDrafts} />
                                  {document.title}
                                </Typography>
                                {document.draft ? (
                                  <Chip
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                    label="Szkic"
                                    sx={{ mt: 1 }}
                                  />
                                ) : null}
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                  {document.person ?? 'Bez przypisanej strony'}
                                </Typography>
                                <Typography variant="body2">
                                  {formatPolishDate(document.documentDate)} · Pliki: {document.files.length}
                                </Typography>
                              </CardContent>
                            </RouterCardActionArea>
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
        <DocumentsTableContainer
          sx={{ display: { xs: 'none', sm: 'block' }, mt: 4, maxWidth: '100%', overflowX: 'auto' }}
        >
          <DocumentsTable stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell
                  padding="checkbox"
                  sx={{ position: 'sticky', left: 0, zIndex: 2 }}
                >
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
                  <DocumentColumnHeadCell key={column}>
                    {DOCUMENT_COLUMN_LABELS[column]}
                  </DocumentColumnHeadCell>
                ))}
                <DocumentColumnHeadCell align="right" sx={{ width: '1%' }}>
                  Akcje
                </DocumentColumnHeadCell>
              </TableRow>
            </TableHead>
            {groupedVisibleDocuments.flatMap((periodGroup) => [
              <TableBody key={`${periodGroup.start}|${periodGroup.end}`}>
                <TableRow>
                  <DocumentPeriodTableCell
                    colSpan={visibleColumnIds.length + 2}
                    sx={{ position: 'sticky', top: DOCUMENTS_TABLE_HEAD_HEIGHT, zIndex: 1 }}
                  >
                    <DocumentPeriodTitle variant="subtitle2">
                      {formatCanonicalDocumentInterval(periodGroup)}
                    </DocumentPeriodTitle>
                  </DocumentPeriodTableCell>
                </TableRow>
              </TableBody>,
              ...periodGroup.people.flatMap((personGroup) => [
                <TableBody
                  key={`${periodGroup.start}|${periodGroup.end}|${personGroup.person}`}
                >
                  <TableRow>
                    <DocumentPersonTableCell colSpan={visibleColumnIds.length + 2}>
                      <DocumentPersonTitle variant="overline">
                        {personGroup.person}
                      </DocumentPersonTitle>
                    </DocumentPersonTableCell>
                  </TableRow>
                </TableBody>,
                ...personGroup.documents.map((document) => (
                  <TableBody
                    key={document.id}
                    component="tbody"
                    data-document-record=""
                    data-selected={selectedIds.includes(document.id) || undefined}
                  >
                    <TableRow
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
                        rowSpan={2}
                        onClick={(event) => event.stopPropagation()}
                        sx={{ verticalAlign: 'middle' }}
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
                      <DocumentRecordTitleCell
                        component="th"
                        scope="rowgroup"
                        colSpan={visibleColumnIds.length}
                        sx={{ pt: 1.25, pb: 0.5 }}
                      >
                        <Link
                          to="/app/documents/$id"
                          params={{ id: document.id }}
                          search={currentDocumentsSearch}
                          onClick={(event) => event.stopPropagation()}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          <DocumentTitleText component="span">
                            <PendingDraftsDot counts={document.pendingDrafts} />
                            {document.title}
                          </DocumentTitleText>
                        </Link>
                      </DocumentRecordTitleCell>
                      <TableCell
                        align="right"
                        rowSpan={2}
                        onClick={(event) => event.stopPropagation()}
                        sx={{ verticalAlign: 'middle' }}
                      >
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
                    <TableRow
                      onClick={() =>
                        void navigate({
                          to: '/app/documents/$id',
                          params: { id: document.id },
                          search: currentDocumentsSearch,
                        })
                      }
                      sx={{ cursor: 'pointer' }}
                    >
                      {visibleColumnIds.map((column) => (
                        <DocumentMetadataCell key={column} sx={{ pt: 0, pb: 1.25 }}>
                          {renderDocumentCell(column, document)}
                        </DocumentMetadataCell>
                      ))}
                    </TableRow>
                  </TableBody>
                )),
              ]),
            ])}
          </DocumentsTable>
        </DocumentsTableContainer>
        </>
      ) : null}

      {visibleDocuments.length > 0 && view === 'timeline' ? (
        <Suspense fallback={<LinearProgress aria-label="Ładowanie osi czasu" sx={{ mt: 3 }} />}>
          <LazyDocumentTimelineView
            documents={visibleDocuments}
            documentTypes={typeOptions}
            onOpenDocument={(id) =>
              void navigate({
                to: '/app/documents/$id',
                params: { id },
                search: currentDocumentsSearch,
              })
            }
          />
        </Suspense>
      ) : null}

      <Menu
        anchorEl={rowMenuAnchor}
        open={Boolean(rowMenuAnchor)}
        onClose={closeRowMenu}
      >
        {rowMenuDocument ? (
          <RouterMenuItem
            to="/app/documents/$id"
            params={{ id: rowMenuDocument.id }}
            search={currentDocumentsSearch}
            onClick={closeRowMenu}
          >
            Otwórz
          </RouterMenuItem>
        ) : null}
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
        open={approveProposalsOpen}
        onClose={bulkBusy ? undefined : () => setApproveProposalsOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Zatwierdź propozycje</DialogTitle>
        <DialogContent>
          <Typography>
            Propozycje zmian zostaną zastosowane{' '}
            {selectedProposalDocuments.length === 1
              ? 'w 1 zaznaczonym dokumencie.'
              : `w ${selectedProposalDocuments.length} zaznaczonych dokumentach.`}
          </Typography>
          {bulkApproveProposals.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {bulkApproveProposals.error.message}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button disabled={bulkBusy} onClick={() => setApproveProposalsOpen(false)}>
            Anuluj
          </Button>
          <Button
            variant="contained"
            disabled={selectedProposalDocuments.length === 0 || bulkBusy}
            onClick={() => void approveSelectedProposals()}
          >
            Zatwierdź propozycje
          </Button>
        </DialogActions>
      </Dialog>

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
                ? 'Ustaw stronę'
                : bulkDialog === 'link'
                  ? 'Dodaj powiązany dokument'
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
                  Nadpiszesz stronę w {selectedDocuments.length} dokumentach.
                </Alert>
                <Autocomplete
                  freeSolo
                  options={personOptions}
                  value={bulkPerson}
                  onChange={(_event, value) => setBulkPerson(value ?? '')}
                  onInputChange={(_event, value) => setBulkPerson(value)}
                  renderInput={(params) => <TextField {...params} label="Strona" />}
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
                    {typeOptions.map((documentType) => (
                      <MenuItem key={documentType.slug} value={documentType.slug}>
                        {documentType.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            ) : null}
            {bulkDialog === 'link' ? (
              <>
                <TextField
                  label="Szukaj po tytule"
                  value={bulkLinkSearch}
                  onChange={(event) => setBulkLinkSearch(event.target.value)}
                />
                <List sx={{ maxHeight: 240, overflow: 'auto' }}>
                  {bulkLinkCandidates.map((candidate) => (
                    <ListItemButton
                      key={candidate.id}
                      selected={bulkLinkTargetId === candidate.id}
                      onClick={() => setBulkLinkTargetId(candidate.id)}
                    >
                      <ListItemText primary={candidate.title} />
                    </ListItemButton>
                  ))}
                  {bulkLinkCandidates.length === 0 ? (
                    <ListItem>
                      <ListItemText primary="Brak dokumentów do powiązania." />
                    </ListItem>
                  ) : null}
                </List>
                <TextField
                  label="Etykieta (opcjonalnie)"
                  value={bulkLinkLabel}
                  slotProps={{ htmlInput: { maxLength: 60 } }}
                  onChange={(event) => setBulkLinkLabel(event.target.value)}
                />
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
              (bulkDialog === 'person' && bulkPerson.trim().length === 0) ||
              (bulkDialog === 'link' && !bulkLinkTargetId)
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
                return;
              }
              if (bulkDialog === 'link') {
                const targetId = bulkLinkTargetId;
                const label = bulkLinkLabel.trim();
                void runBulk(
                  async (document) => {
                    if (document.id === targetId) return 'skipped';
                    try {
                      await bulkLinkDocuments.mutateAsync({
                        documentId: document.id,
                        input: {
                          otherDocumentId: targetId,
                          ...(label ? { label } : {}),
                        },
                      });
                    } catch (error) {
                      if (error instanceof ApiError && error.appError.code === 'conflict') {
                        return 'skipped';
                      }
                      throw error;
                    }
                  },
                  { summaryKind: 'linked' },
                );
              }
            }}
          >
            {bulkDialog === 'link' ? 'Dodaj' : 'Zastosuj'}
          </Button>
        </DialogActions>
      </Dialog>

      <DocumentFormDialog
        open={createOpen}
        title="Dodaj dokument"
        submitLabel="Dodaj dokument"
        pending={createDocument.isPending}
        documentTypes={typeOptions}
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
            {documentFilterSummary(documentFilter, typeOptions)}
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
    </PageContainer>
  );
};
