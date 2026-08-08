import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { DocumentType } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { formatPolishDate } from '../../lib/format-date.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  FILE_ROLE_SYMBOLS,
  toDocumentFilter,
  toDocumentInput,
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

interface DocumentFilters {
  text: string;
  docType: DocumentType | '';
  person: string;
  dateFrom: string;
  dateTo: string;
}

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archiveHasDocuments, setArchiveHasDocuments] = useState(false);
  const [filters, setFilters] = useState<DocumentFilters>({
    text: '',
    docType: '',
    person: '',
    dateFrom: '',
    dateTo: '',
  });
  const documents = useQuery(actions.documents(toDocumentFilter(filters)));
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

  const updateFilter = (name: keyof DocumentFilters, value: string) =>
    setFilters((current) => ({ ...current, [name]: value }));
  const filtersActive = Object.values(filters).some((value) => value.length > 0);
  const visibleDocuments = documents.data?.documents ?? [];

  useEffect(() => {
    if (visibleDocuments.length > 0) setArchiveHasDocuments(true);
  }, [visibleDocuments.length]);

  const clearFilters = () =>
    setFilters({
      text: '',
      docType: '',
      person: '',
      dateFrom: '',
      dateTo: '',
    });

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

      {archiveHasDocuments ? <Paper sx={{ mt: 4, p: 2 }}>
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
              onChange={(event) => updateFilter('docType', event.target.value)}
            >
              <MenuItem value="">Wszystkie</MenuItem>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Osoba"
            value={filters.person}
            onChange={(event) => updateFilter('person', event.target.value)}
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
        </Stack>
      </Paper> : null}

      {archiveHasDocuments ? <Stack
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
        <Alert sx={{ mt: 2 }}>{exportDocuments.error.message}</Alert>
      ) : null}

      {documents.isPending ? (
        <Box sx={{ mt: 4 }}>
          <StatusView state={{ kind: 'loading', label: 'Ładowanie dokumentów…' }} />
        </Box>
      ) : null}
      {documents.isError ? (
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
      {visibleDocuments.length === 0 && !filtersActive && documents.isSuccess ? (
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
      {visibleDocuments.length > 0 ? (
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
                <TableCell>Data dokumentu</TableCell>
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
        onClose={() => setCreateOpen(false)}
        onSubmit={(values) => createDocument.mutate(toDocumentInput(values))}
      />
    </PageContainer>
  );
};
