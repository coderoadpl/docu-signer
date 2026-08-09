import { useEffect, useState } from 'react';
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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import {
  documentSignatureStatusSchema,
  documentTypeSchema,
  type SavedSearch,
  type SavedSearchFilter,
} from '#core/domain/index.js';

import { actions, savedSearchActions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { formatPolishDate } from '../../lib/format-date.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  FILE_ROLE_SYMBOLS,
  SIGNATURE_STATUS_LABELS,
  documentFilterSummary,
  emptyDocumentFilters,
  hasDocumentFilter,
  toDocumentFilter,
  toDocumentFilterValues,
  toDocumentInput,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  type DocumentFilterValues,
} from './documents.logic.js';

const FileCounts = ({ files }: { files: Array<{ role: string }> }) => (
  <Stack direction="row" sx={{ gap: 0.5 }}>
    {(['source', 'signed-scan', 'signed-digital'] as const).map((role) => {
      const count = files.filter((file) => file.role === role).length;
      return (
        <Chip
          key={role}
          size="small"
          variant="outlined"
          label={`${FILE_ROLE_SYMBOLS[role]} ${count}`}
          aria-label={`${FILE_ROLE_LABELS[role]}: ${count}`}
        />
      );
    })}
  </Stack>
);

type DocumentsView = 'list' | 'folders';

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
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [savedSearchOpen, setSavedSearchOpen] = useState(false);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<DocumentsView>('list');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archiveHasDocuments, setArchiveHasDocuments] = useState(false);
  const [filters, setFilters] = useState<DocumentFilterValues>(emptyDocumentFilters);
  const documentFilter = toDocumentFilter(filters);
  const documents = useQuery(actions.documents(documentFilter));
  const folderDocuments = useQuery(actions.documents({}));
  const savedSearches = useQuery(savedSearchActions.savedSearches);
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

  const updateFilter = <Name extends keyof DocumentFilterValues,>(
    name: Name,
    value: DocumentFilterValues[Name],
  ) =>
    setFilters((current) => ({ ...current, [name]: value }));
  const filtersActive = hasDocumentFilter(documentFilter);
  const visibleDocuments = documents.data?.documents ?? [];
  const allDocuments = folderDocuments.data?.documents ?? visibleDocuments;
  const personOptions = uniqueDocumentPersons(allDocuments);
  const tagOptions = uniqueDocumentTags(allDocuments);
  const savedSearchItems: SavedSearch[] = savedSearches.data?.savedSearches ?? [];

  useEffect(() => {
    if (allDocuments.length > 0) setArchiveHasDocuments(true);
  }, [allDocuments.length]);

  const clearFilters = () => setFilters(emptyDocumentFilters());

  const saveCurrentSearch = () => {
    const name = savedSearchName.trim();
    if (!name || !filtersActive) return;
    createSavedSearch.mutate({ name, filter: documentFilter });
  };

  const applySavedSearch = (filter: SavedSearchFilter) => {
    setFilters(toDocumentFilterValues(filter));
    setSelectedIds([]);
    setView('list');
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
        {archiveHasDocuments ? (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Dodaj dokument
          </Button>
        ) : null}
      </Stack>

      {archiveHasDocuments ? (
        <Tabs
          value={view}
          onChange={(_event, value: DocumentsView) => setView(value)}
          sx={{ mt: 4 }}
        >
          <Tab value="list" label="Lista" />
          <Tab value="folders" label="Teczki" />
        </Tabs>
      ) : null}

      {archiveHasDocuments && view === 'list' ? <Paper sx={{ mt: 3, p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ gap: 2 }}>
          <TextField
            label="Szukaj po tytule"
            value={filters.text}
            onChange={(event) => updateFilter('text', event.target.value)}
            sx={{ flex: 2 }}
          />
          <FormControl sx={{ minWidth: '10rem', flex: 1 }}>
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
            sx={{ flex: 1 }}
          />
          <Autocomplete
            freeSolo
            options={tagOptions}
            value={filters.tag}
            onChange={(_event, value) => updateFilter('tag', value ?? '')}
            onInputChange={(_event, value) => updateFilter('tag', value)}
            renderInput={(params) => <TextField {...params} label="Tag" />}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Od"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Do"
            type="date"
            value={filters.dateTo}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <FormControl sx={{ minWidth: '11rem', flex: 1 }}>
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
          <Button
            variant="outlined"
            disabled={!filtersActive}
            onClick={() => setSavedSearchOpen(true)}
            sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            style={{ whiteSpace: 'nowrap' }}
          >
            Zapisz teczkę
          </Button>
        </Stack>
      </Paper> : null}

      {archiveHasDocuments && view === 'folders' ? (
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

      {archiveHasDocuments && view === 'list' ? <Stack
        direction="row"
        sx={{ mt: 3, alignItems: 'center', justifyContent: 'flex-end' }}
      >
        <Button
          variant="contained"
          disabled={selectedIds.length === 0 || exportDocuments.isPending}
          onClick={() => exportDocuments.mutate({ documentIds: selectedIds })}
        >
          Eksportuj zaznaczone ({selectedIds.length})
        </Button>
      </Stack> : null}
      {exportDocuments.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>{exportDocuments.error.message}</Alert>
      ) : null}

      {view === 'list' && documents.isPending ? (
        <Box sx={{ mt: 4 }}>
          <StatusView state={{ kind: 'loading', label: 'Ładowanie dokumentów…' }} />
        </Box>
      ) : null}
      {view === 'list' && documents.isError ? (
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
      archiveHasDocuments &&
      view === 'list' &&
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
      {visibleDocuments.length === 0 && !filtersActive && view === 'list' && documents.isSuccess ? (
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
          {visibleDocuments.map((document) => (
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
                    })
                  }
                >
                  <CardContent>
                    <Typography variant="h2">{document.title}</Typography>
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
        <TableContainer component={Paper} sx={{ display: { xs: 'none', sm: 'block' }, mt: 4 }}>
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
                <TableCell>Data podpisania</TableCell>
                <TableCell>Tytuł</TableCell>
                <TableCell>Typ</TableCell>
                <TableCell>Osoba</TableCell>
                <TableCell>Pliki</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleDocuments.map((document) => (
                <TableRow
                  key={document.id}
                  hover
                  onClick={() =>
                    void navigate({
                      to: '/app/documents/$id',
                      params: { id: document.id },
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
                  <TableCell>{formatPolishDate(document.documentDate)}</TableCell>
                  <TableCell>{document.title}</TableCell>
                  <TableCell>
                    <Chip
                      variant="outlined"
                      label={DOCUMENT_TYPE_LABELS[document.docType]}
                    />
                  </TableCell>
                  <TableCell>{document.person ?? '—'}</TableCell>
                  <TableCell>
                    <FileCounts files={document.files} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        </>
      ) : null}

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
    </PageContainer>
  );
};
