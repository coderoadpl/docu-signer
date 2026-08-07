import { useState, type DragEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { DocumentFile, DocumentFileRole } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { FileDropZone, PdfPreview } from '../../theme.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  FILE_ROLE_SYMBOLS,
  filesByRole,
  formatFileSize,
  toDocumentInput,
  uploadErrorMessage,
} from './documents.logic.js';
import { uploadDocumentFile } from './upload.logic.js';

const FILE_ROLES: DocumentFileRole[] = ['source', 'signed-scan', 'signed-digital', 'other'];

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
      <Button variant="contained" color="error" onClick={onConfirm} disabled={pending}>
        Usuń
      </Button>
    </DialogActions>
  </Dialog>
);

const FileRow = ({
  documentId,
  file,
  onDelete,
}: {
  documentId: string;
  file: DocumentFile;
  onDelete: (file: DocumentFile) => void;
}) => {
  const contentUrl = actions.fileContentUrl(documentId, file.id);
  return (
    <ListItem>
      <ListItemText
        primary={file.fileName}
        secondary={`${formatFileSize(file.sizeBytes)} · ${new Date(file.createdAt).toLocaleDateString('pl-PL')}`}
      />
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Link href={contentUrl} target="_blank" rel="noreferrer">
          Podgląd
        </Link>
        <Link href={contentUrl} download={file.fileName}>
          Pobierz
        </Link>
        <Button color="error" onClick={() => onDelete(file)}>
          Usuń
        </Button>
      </Stack>
    </ListItem>
  );
};

const Preview = ({ documentId, files }: { documentId: string; files: DocumentFile[] }) => {
  const source = files.find((file) => file.role === 'source');
  const signed = files.find((file) => file.role === 'signed-digital') ??
    files.find((file) => file.role === 'signed-scan');
  const previewFiles = source && signed ? [source, signed] : [source ?? signed ?? files[0]].filter(
    (file): file is DocumentFile => Boolean(file),
  );
  if (!previewFiles.length) return null;
  return (
    <Box component="section" sx={{ mt: 5 }}>
      <Typography variant="h2" sx={{ mb: 2 }}>
        Podgląd
      </Typography>
      <Stack direction={{ xs: 'column', md: previewFiles.length > 1 ? 'row' : 'column' }} sx={{ gap: 2 }}>
        {previewFiles.map((file) => (
          <Box key={file.id} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline">{FILE_ROLE_LABELS[file.role]}</Typography>
            {file.contentType.toLowerCase().startsWith('image/') ? (
              <Box
                component="img"
                src={actions.fileContentUrl(documentId, file.id)}
                alt={`Podgląd: ${file.fileName}`}
                sx={{ display: 'block', width: '100%', maxHeight: '32rem', objectFit: 'contain' }}
              />
            ) : (
              <PdfPreview
                data={actions.fileContentUrl(documentId, file.id)}
                type={file.contentType}
                aria-label={`Podgląd: ${file.fileName}`}
              >
                <Link href={actions.fileContentUrl(documentId, file.id)}>Otwórz {file.fileName}</Link>
              </PdfPreview>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

const RoleFiles = ({
  documentId,
  role,
  files,
  uploading,
  uploadError,
  onUpload,
  onDelete,
}: {
  documentId: string;
  role: DocumentFileRole;
  files: DocumentFile[];
  uploading: boolean;
  uploadError?: string | undefined;
  onUpload: (file: File, role: DocumentFileRole) => void;
  onDelete: (file: DocumentFile) => void;
}) => {
  const acceptFile = (file: File | undefined) => {
    if (file) onUpload(file, role);
  };
  return (
    <Paper component="section" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
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
        <Typography variant="body2">Przeciągnij tutaj plik PDF lub obraz</Typography>
      </FileDropZone>
      {uploading ? <LinearProgress aria-label={`Wgrywanie: ${FILE_ROLE_LABELS[role]}`} sx={{ mt: 2 }} /> : null}
      {uploadError ? <Alert sx={{ mt: 2 }}>{uploadError}</Alert> : null}
      {files.length ? (
        <List disablePadding sx={{ mt: 1 }}>
          {files.map((file) => (
            <FileRow key={file.id} documentId={documentId} file={file} onDelete={onDelete} />
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

export const DocumentDetailPage = ({ documentId }: { documentId: string }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documentQuery = useQuery(actions.document(documentId));
  const [editOpen, setEditOpen] = useState(false);
  const [deleteDocumentOpen, setDeleteDocumentOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<DocumentFile>();
  const [uploadingRole, setUploadingRole] = useState<DocumentFileRole>();
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<DocumentFileRole, string>>>({});
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
      await queryClient.invalidateQueries(actions.documentsInvalidates());
      await navigate({ to: '/documents' });
    },
  });
  const removeFile = useMutation({
    ...actions.removeFile,
    onSuccess: async () => {
      setFileToDelete(undefined);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const requestUpload = useMutation(actions.requestFileUpload);
  const directUpload = useMutation(actions.directFileUpload);
  const finalizeUpload = useMutation(actions.finalizeFileUpload);
  const serverUpload = useMutation(actions.serverUpload);

  if (documentQuery.isPending) {
    return (
      <Container sx={{ py: 6 }}>
        <Typography>Ładowanie dokumentu…</Typography>
      </Container>
    );
  }
  if (documentQuery.isError) {
    return (
      <Container sx={{ py: 6 }}>
        <Alert>{documentQuery.error.message}</Alert>
      </Container>
    );
  }

  const document = documentQuery.data.document;
  const grouped = filesByRole(document.files);
  const upload = async (file: File, role: DocumentFileRole) => {
    setUploadingRole(role);
    setUploadErrors((current) => ({ ...current, [role]: undefined }));
    try {
      await uploadDocumentFile(file, role, {
        request: (input) => requestUpload.mutateAsync({ documentId, input }),
        direct: (input) => directUpload.mutateAsync(input),
        finalize: (input) => finalizeUpload.mutateAsync({ documentId, input }),
        server: (input) => serverUpload.mutateAsync({ documentId, input }),
      });
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    } catch (error) {
      setUploadErrors((current) => ({ ...current, [role]: uploadErrorMessage(error) }));
    } finally {
      setUploadingRole(undefined);
    }
  };

  return (
    <Container sx={{ maxWidth: '76rem !important', px: 2, py: 6 }}>
      <Button onClick={() => void navigate({ to: '/documents' })}>← Dokumenty</Button>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ mt: 3, gap: 3, justifyContent: 'space-between' }}>
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h1">{document.title}</Typography>
            <Chip variant="outlined" label={DOCUMENT_TYPE_LABELS[document.docType]} />
          </Stack>
          <Typography sx={{ mt: 1 }}>
            {document.documentDate} · {document.person ?? 'Bez przypisanej osoby'}
          </Typography>
          {document.tags.length ? (
            <Stack direction="row" sx={{ mt: 1, gap: 1, flexWrap: 'wrap' }}>
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
            onUpload={(file, selectedRole) => void upload(file, selectedRole)}
            onDelete={setFileToDelete}
          />
        ))}
      </Stack>
      <Preview documentId={documentId} files={document.files} />

      <DocumentFormDialog
        open={editOpen}
        title="Edytuj dokument"
        submitLabel="Zapisz"
        initialValues={{
          title: document.title,
          docType: document.docType,
          documentDate: document.documentDate,
          person: document.person ?? '',
          tags: document.tags.join(', '),
        }}
        pending={updateDocument.isPending}
        error={updateDocument.error?.message}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) => updateDocument.mutate({ documentId, input: toDocumentInput(values) })}
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
        pending={removeFile.isPending}
        onCancel={() => setFileToDelete(undefined)}
        onConfirm={() => {
          if (fileToDelete) removeFile.mutate({ documentId, fileId: fileToDelete.id });
        }}
      />
    </Container>
  );
};
