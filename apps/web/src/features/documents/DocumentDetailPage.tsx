import { useState, type DragEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  Menu,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  SvgIcon,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import {
  documentTypeSchema,
  type DocumentFile,
  type DocumentFileRole,
  type DocumentType,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { formatPolishDate } from '../../lib/format-date.js';
import { FileDropZone } from '../../theme.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  FILE_ROLE_SYMBOLS,
  canSignPdfFile,
  fileNameStem,
  filesByRole,
  formatFileSize,
  toDocumentInput,
  uniqueDocumentTags,
  uploadErrorMessage,
} from './documents.logic.js';
import { uploadDocumentFile } from './upload.logic.js';

const FILE_ROLES: DocumentFileRole[] = [
  'source',
  'signed-scan',
  'signed-digital',
  'other',
];

const VisibilityIcon = () => (
  <SvgIcon>
    <path d="M12 5c4.1 0 7.5 2.3 9.5 7-2 4.7-5.4 7-9.5 7s-7.5-2.3-9.5-7c2-4.7 5.4-7 9.5-7Zm0 2c-3.1 0-5.6 1.6-7.3 5 1.7 3.4 4.2 5 7.3 5s5.6-1.6 7.3-5C17.6 8.6 15.1 7 12 7Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
  </SvgIcon>
);

const DownloadIcon = () => (
  <SvgIcon>
    <path d="M11 4h2v8.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V4Zm-5 14h12v2H6v-2Z" />
  </SvgIcon>
);

const MoreVertIcon = () => (
  <SvgIcon>
    <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </SvgIcon>
);

const ConfirmDialog = ({
  open,
  title,
  text,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <Dialog open={open} onClose={pending ? undefined : onCancel}>
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>
      <Typography>{text}</Typography>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel} disabled={pending}>
        Anuluj
      </Button>
      <Button
        variant="contained"
        color="error"
        onClick={onConfirm}
        disabled={pending}
      >
        Usuń
      </Button>
    </DialogActions>
  </Dialog>
);

const FileRow = ({
  documentId,
  file,
  onSign,
  onMove,
  onDelete,
}: {
  documentId: string;
  file: DocumentFile;
  onSign: (file: DocumentFile) => void;
  onMove: (file: DocumentFile) => void;
  onDelete: (file: DocumentFile) => void;
}) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [afterMenuClose, setAfterMenuClose] = useState<(() => void) | undefined>();
  const contentUrl = actions.documentFileContentUrl(documentId, file.id);
  const exportUrl = actions.documentFileExportUrl(documentId, file.id);
  const closeMenu = () => setMenuAnchor(null);
  const runAfterMenuClose = (action: () => void) => {
    setAfterMenuClose(() => action);
    closeMenu();
  };
  const handleMenuExited = () => {
    if (!afterMenuClose) return;
    afterMenuClose();
    setAfterMenuClose(undefined);
  };
  return (
    <ListItem
      disableGutters
      sx={{
        gap: 1.5,
        minWidth: 0,
        py: 0.75,
      }}
    >
      <ListItemText
        primary={file.fileName}
        secondary={formatFileSize(file.sizeBytes)}
        slotProps={{
          primary: { noWrap: true },
          secondary: { noWrap: true },
        }}
        sx={{ minWidth: 0 }}
      />
      <Stack
        direction="row"
        sx={{ alignItems: 'center', flexShrink: 0, gap: 0.5 }}
      >
        <Tooltip title="Podgląd" describeChild disableInteractive>
          <IconButton
            aria-label={`Podgląd pliku ${file.fileName}`}
            component="a"
            href={contentUrl}
            target="_blank"
            rel="noreferrer"
            size="small"
          >
            <VisibilityIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Pobierz" describeChild disableInteractive>
          <IconButton
            aria-label={`Pobierz plik ${file.fileName}`}
            component="a"
            href={contentUrl}
            download={file.fileName}
            size="small"
          >
            <DownloadIcon />
          </IconButton>
        </Tooltip>
        {canSignPdfFile(file) ? (
          <Button
            variant="contained"
            size="small"
            onClick={() => onSign(file)}
          >
            Podpisz
          </Button>
        ) : null}
        <IconButton
          aria-label={`Więcej akcji dla pliku ${file.fileName}`}
          aria-controls={menuAnchor ? `file-actions-${file.id}` : undefined}
          aria-haspopup="menu"
          aria-expanded={menuAnchor ? true : undefined}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          size="small"
          title="Więcej"
        >
          <MoreVertIcon />
        </IconButton>
        <Menu
          id={`file-actions-${file.id}`}
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={closeMenu}
          slotProps={{
            transition: { onExited: handleMenuExited },
          }}
        >
          <MenuItem component="a" href={exportUrl} onClick={closeMenu}>
            Eksportuj
          </MenuItem>
          <MenuItem
            onClick={() => {
              runAfterMenuClose(() => onMove(file));
            }}
          >
            Przenieś do nowego dokumentu
          </MenuItem>
          <MenuItem
            onClick={() => {
              runAfterMenuClose(() => onDelete(file));
            }}
          >
            <Typography color="error">Usuń</Typography>
          </MenuItem>
        </Menu>
      </Stack>
    </ListItem>
  );
};

const RoleFiles = ({
  documentId,
  role,
  files,
  uploading,
  uploadError,
  onUpload,
  onSign,
  onMove,
  onDelete,
}: {
  documentId: string;
  role: DocumentFileRole;
  files: DocumentFile[];
  uploading: boolean;
  uploadError?: string | undefined;
  onUpload: (file: File, role: DocumentFileRole) => void;
  onSign: (file: DocumentFile) => void;
  onMove: (file: DocumentFile) => void;
  onDelete: (file: DocumentFile) => void;
}) => {
  const acceptFile = (file: File | undefined) => {
    if (file) onUpload(file, role);
  };
  return (
    <Paper component="section" sx={{ p: 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
      >
        <Typography variant="h2">
          {FILE_ROLE_SYMBOLS[role]} {FILE_ROLE_LABELS[role]}
        </Typography>
        <Button component="label" variant="contained" disabled={uploading}>
          Wgraj plik
          <input
            hidden
            type="file"
            accept="application/pdf,image/*"
            onChange={(event) => {
              acceptFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </Button>
      </Stack>
      <FileDropZone
        onDragOver={(event: DragEvent) => event.preventDefault()}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          acceptFile(event.dataTransfer.files[0]);
        }}
        sx={{ mt: 2, p: 2 }}
      >
        <Typography variant="body2">
          Przeciągnij tutaj plik PDF lub obraz
        </Typography>
      </FileDropZone>
      {uploading ? (
        <LinearProgress
          aria-label={`Wgrywanie: ${FILE_ROLE_LABELS[role]}`}
          sx={{ mt: 2 }}
        />
      ) : null}
      {uploadError ? <Alert sx={{ mt: 2 }}>{uploadError}</Alert> : null}
      {files.length ? (
        <List disablePadding sx={{ mt: 1 }}>
          {files.map((file) => (
            <FileRow
              key={file.id}
              documentId={documentId}
              file={file}
              onSign={onSign}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </List>
      ) : (
        <Typography variant="body2" sx={{ mt: 2 }}>
          Brak plików w tej sekcji.
        </Typography>
      )}
    </Paper>
  );
};

export const DocumentDetailPage = ({
  documentId,
}: {
  documentId: string;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documentQuery = useQuery(actions.document(documentId));
  const folderDocuments = useQuery(actions.documents({}));
  const [editOpen, setEditOpen] = useState(false);
  const [deleteDocumentOpen, setDeleteDocumentOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<DocumentFile>();
  const [fileToMove, setFileToMove] = useState<DocumentFile>();
  const [moveTitle, setMoveTitle] = useState('');
  const [moveDocType, setMoveDocType] = useState<DocumentType>('umowa-uod');
  const [uploadingRole, setUploadingRole] = useState<DocumentFileRole>();
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<DocumentFileRole, string>>
  >({});
  const updateDocument = useMutation({
    ...actions.updateDocument,
    onSuccess: async () => {
      setEditOpen(false);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const deleteDocument = useMutation({
    ...actions.deleteDocument,
    onSuccess: async () => {
      await navigate({ to: '/app/documents' });
      queryClient.removeQueries(actions.document(documentId));
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const deleteFile = useMutation({
    ...actions.deleteDocumentFile,
    onSuccess: async () => {
      setFileToDelete(undefined);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const moveFile = useMutation({
    ...actions.moveDocumentFile,
    onSuccess: async ({ document: movedDocument }) => {
      setFileToMove(undefined);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
      await navigate({
        to: '/app/documents/$id',
        params: { id: movedDocument.id },
      });
    },
  });
  const requestUpload = useMutation(actions.requestFileUpload);
  const directUpload = useMutation(actions.directFileUpload);
  const finalizeUpload = useMutation(actions.finalizeFileUpload);
  const serverUpload = useMutation(actions.uploadDocumentFile);

  if (documentQuery.isPending) {
    return (
      <PageContainer>
        <StatusView state={{ kind: 'loading', label: 'Ładowanie dokumentu…' }} />
      </PageContainer>
    );
  }
  if (documentQuery.isError) {
    return (
      <PageContainer>
        <StatusView
          state={{
            kind: 'error',
            message: documentQuery.error.message,
            retry: {
              label: 'Spróbuj ponownie',
              onRetry: () => void documentQuery.refetch(),
            },
          }}
        />
      </PageContainer>
    );
  }

  const document = documentQuery.data.document;
  const grouped = filesByRole(document.files);
  const tagOptions = uniqueDocumentTags(folderDocuments.data?.documents ?? [document]);
  const period =
    document.periodStart || document.periodEnd
      ? [
          document.periodStart ? formatPolishDate(document.periodStart) : '—',
          document.periodEnd ? formatPolishDate(document.periodEnd) : '—',
        ].join(' - ')
      : null;
  const upload = async (file: File, role: DocumentFileRole) => {
    setUploadingRole(role);
    setUploadErrors((current) => ({ ...current, [role]: undefined }));
    try {
      await uploadDocumentFile(file, role, {
        request: (input) =>
          requestUpload.mutateAsync({ documentId, input }),
        direct: (input) => directUpload.mutateAsync(input),
        finalize: (input) =>
          finalizeUpload.mutateAsync({ documentId, input }),
        server: (input) =>
          serverUpload.mutateAsync({ documentId, input }),
      });
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    } catch (error) {
      setUploadErrors((current) => ({
        ...current,
        [role]: uploadErrorMessage(error),
      }));
    } finally {
      setUploadingRole(undefined);
    }
  };
  const startMove = (file: DocumentFile) => {
    setFileToMove(file);
    setMoveTitle(fileNameStem(file.fileName));
    setMoveDocType(document.docType);
  };

  return (
    <PageContainer>
      <Button onClick={() => void navigate({ to: '/app/documents' })}>
        ← Dokumenty
      </Button>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ mt: 3, gap: 3, justifyContent: 'space-between' }}
      >
        <Box>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
          >
            <Typography variant="h1">{document.title}</Typography>
            <Chip
              variant="outlined"
              label={DOCUMENT_TYPE_LABELS[document.docType]}
            />
          </Stack>
          <Stack sx={{ mt: 1, gap: 0.5 }}>
            <Typography>
              Data podpisania: {formatPolishDate(document.documentDate)}
            </Typography>
            {period ? <Typography>Okres: {period}</Typography> : null}
            <Typography>{document.person ?? 'Bez przypisanej osoby'}</Typography>
          </Stack>
          {document.tags.length ? (
            <Stack
              direction="row"
              sx={{ mt: 1, gap: 1, flexWrap: 'wrap' }}
            >
              {document.tags.map((tag) => (
                <Chip key={tag} size="small" label={tag} />
              ))}
            </Stack>
          ) : null}
        </Box>
        <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 2 }}>
          <Button variant="contained" onClick={() => setEditOpen(true)}>
            Edytuj
          </Button>
          <Button color="error" onClick={() => setDeleteDocumentOpen(true)}>
            Usuń dokument
          </Button>
        </Stack>
      </Stack>

      <Divider sx={{ my: 4 }} />
      <Typography variant="h1" component="h2" sx={{ mb: 3 }}>
        Pliki
      </Typography>
      <Stack sx={{ gap: 3 }}>
        {FILE_ROLES.map((role) => (
          <RoleFiles
            key={role}
            documentId={documentId}
            role={role}
            files={grouped[role]}
            uploading={uploadingRole === role}
            uploadError={uploadErrors[role]}
            onUpload={(file, selectedRole) =>
              void upload(file, selectedRole)
            }
            onSign={(file) =>
              void navigate({
                to: '/app/documents/$id/sign/$fileId',
                params: { id: documentId, fileId: file.id },
              })
            }
            onMove={startMove}
            onDelete={setFileToDelete}
          />
        ))}
      </Stack>

      <DocumentFormDialog
        open={editOpen}
        title="Edytuj dokument"
        submitLabel="Zapisz"
        initialValues={{
          title: document.title,
          docType: document.docType,
          documentDate: document.documentDate,
          periodStart: document.periodStart ?? '',
          periodEnd: document.periodEnd ?? '',
          person: document.person ?? '',
          tags: document.tags.join(', '),
        }}
        pending={updateDocument.isPending}
        error={updateDocument.error?.message}
        tagOptions={tagOptions}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) =>
          updateDocument.mutate({
            documentId,
            input: toDocumentInput(values),
          })
        }
      />
      <ConfirmDialog
        open={deleteDocumentOpen}
        title="Usunąć dokument?"
        text="Dokument i wszystkie jego pliki zostaną trwale usunięte."
        pending={deleteDocument.isPending}
        onCancel={() => setDeleteDocumentOpen(false)}
        onConfirm={() => deleteDocument.mutate(documentId)}
      />
      <ConfirmDialog
        open={Boolean(fileToDelete)}
        title="Usunąć plik?"
        text={`Plik „${fileToDelete?.fileName ?? ''}” zostanie trwale usunięty.`}
        pending={deleteFile.isPending}
        onCancel={() => setFileToDelete(undefined)}
        onConfirm={() => {
          if (fileToDelete) {
            deleteFile.mutate({ documentId, fileId: fileToDelete.id });
          }
        }}
      />
      <Dialog
        open={Boolean(fileToMove)}
        onClose={moveFile.isPending ? undefined : () => setFileToMove(undefined)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Przenieś do nowego dokumentu</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <TextField
              label="Tytuł"
              value={moveTitle}
              onChange={(event) => setMoveTitle(event.target.value)}
            />
            <FormControl required>
              <InputLabel id="move-document-type-label">Typ</InputLabel>
              <Select
                labelId="move-document-type-label"
                label="Typ"
                value={moveDocType}
                onChange={(event) =>
                  setMoveDocType(documentTypeSchema.parse(event.target.value))
                }
              >
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {moveFile.error ? <Alert severity="error">{moveFile.error.message}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFileToMove(undefined)} disabled={moveFile.isPending}>
            Anuluj
          </Button>
          <Button
            variant="contained"
            disabled={!moveTitle.trim() || !fileToMove || moveFile.isPending}
            onClick={() => {
              if (!fileToMove) return;
              moveFile.mutate({
                documentId,
                fileId: fileToMove.id,
                input: { title: moveTitle, docType: moveDocType },
              });
            }}
          >
            {moveFile.isPending ? 'Przenoszenie…' : 'Przenieś'}
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};
