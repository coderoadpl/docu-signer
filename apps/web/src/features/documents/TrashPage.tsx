import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
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
import { createLink, Link, useNavigate } from '@tanstack/react-router';

import type { DocumentWithFiles } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { formatPolishDate } from '../../lib/format-date.js';
import { documentTypeLabel } from './documents.logic.js';

const TRASH_EMPTY_CONFIRMATION = 'OPRÓŻNIJ KOSZ';

const RouterCardActionArea = createLink(CardActionArea);

const trashErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Nie udało się wykonać akcji w koszu.';

export const TrashPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [trashConfirmDocument, setTrashConfirmDocument] = useState<DocumentWithFiles | null>(null);
  const [trashBusyIds, setTrashBusyIds] = useState<string[]>([]);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashSummary, setTrashSummary] = useState<{ deleted: number; errors: number } | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashConfirmation, setEmptyTrashConfirmation] = useState('');
  const trashedDocuments = useQuery(actions.trashedDocuments);
  const documentTypes = useQuery(actions.documentTypes);
  const restoreDocument = useMutation(actions.restoreDocument);
  const purgeDocument = useMutation(actions.purgeDocument);
  const trashedItems = trashedDocuments.data?.documents ?? [];
  const typeOptions = documentTypes.data?.documentTypes ?? [];

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

  const openDocument = (documentId: string) => {
    void navigate({
      to: '/app/documents/$id',
      params: { id: documentId },
      search: {},
    });
  };

  return (
    <PageContainer>
      <Box>
        <Typography variant="overline">Archiwum</Typography>
        <Typography variant="h1">Kosz</Typography>
      </Box>
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
                      <RouterCardActionArea
                        to="/app/documents/$id"
                        params={{ id: document.id }}
                        search={{}}
                        disabled={busy}
                      >
                        <CardContent>
                          <Typography variant="h2">{document.title}</Typography>
                          <Stack direction="row" sx={{ mt: 1, gap: 0.75, flexWrap: 'wrap' }}>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={documentTypeLabel(typeOptions, document.docType)}
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`Usunięto: ${formatPolishDate(document.deletedAt ?? '')}`}
                            />
                          </Stack>
                          <Typography variant="body2" sx={{ mt: 1 }}>
                            {document.person ?? 'Bez przypisanej strony'}
                          </Typography>
                        </CardContent>
                      </RouterCardActionArea>
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
                      <LinearProgress aria-label={`Przetwarzanie dokumentu ${document.title}`} />
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
                    <TableCell>Strona</TableCell>
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
                        onClick={() => openDocument(document.id)}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {formatPolishDate(document.deletedAt ?? '')}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Link
                            to="/app/documents/$id"
                            params={{ id: document.id }}
                            search={{}}
                            onClick={(event) => event.stopPropagation()}
                            style={{ color: 'inherit', textDecoration: 'none' }}
                          >
                            <Typography variant="subtitle2" component="span">
                              {document.title}
                            </Typography>
                          </Link>
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
                            label={documentTypeLabel(typeOptions, document.docType)}
                          />
                        </TableCell>
                        <TableCell>{document.person ?? '—'}</TableCell>
                        <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                          <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
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
      <Dialog
        open={Boolean(trashConfirmDocument)}
        onClose={() => setTrashConfirmDocument(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Usunąć trwale?</DialogTitle>
        <DialogContent>
          <Typography>
            Dokument „{trashConfirmDocument?.title ?? ''}” i wszystkie jego pliki zostaną
            trwale usunięte z magazynu blob. Tej operacji nie można cofnąć.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrashConfirmDocument(null)}>Anuluj</Button>
          <Button
            variant="contained"
            color="error"
            disabled={
              !trashConfirmDocument || trashBusyIds.includes(trashConfirmDocument.id)
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
              Wszystkie dokumenty widoczne w koszu i ich pliki zostaną trwale usunięte z
              magazynu blob. Tej operacji nie można cofnąć.
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
