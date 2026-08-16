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
  ListItemButton,
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
import { useNavigate, useSearch } from '@tanstack/react-router';

import { replaySignatureRecordsPdf } from '#core/client/index.js';
import {
  documentTypeSchema,
  type DocumentFile,
  type DocumentFileRole,
  type SourceUpdateRequest,
  type DocumentType,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { formatPolishDate, formatPolishDateTime } from '../../lib/format-date.js';
import { DocumentCommentBody, FileDropZone, NoWrapButton } from '../../theme.js';
import { DocumentFormDialog } from './DocumentFormDialog.js';
import { SourceUpdateDialog } from './SourceUpdateDialog.js';
import {
  DOCUMENT_TYPE_LABELS,
  FILE_ROLE_LABELS,
  canSignPdfFile,
  documentFiltersFromSearch,
  documentsSearchFromState,
  documentsViewFromSearch,
  fileNameStem,
  filesByRole,
  formatFileSize,
  toDocumentInput,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  uploadErrorMessage,
} from './documents.logic.js';
import { uploadDocumentFile } from './upload.logic.js';
import {
  sourceUpdateNeedsReplay,
  sourceUpdateReadyToComplete,
} from './source-update.logic.js';

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
  <SvgIcon fontSize="small">
    <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </SvgIcon>
);

const DeleteIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2H7Zm10-16H7V3h3l1-1h2l1 1h3v2Zm-8 4v8h2V9H9Zm4 0v8h2V9h-2Z" />
  </SvgIcon>
);

const ConfirmDialog = ({
  open,
  title,
  text,
  confirmLabel = 'Usuń',
  pending,
  color = 'error',
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  confirmLabel?: string;
  pending: boolean;
  color?: 'primary' | 'error';
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
        color={color}
        onClick={onConfirm}
        disabled={pending}
      >
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

const FileRow = ({
  documentId,
  file,
  readOnly = false,
  onSign,
  onMove,
  onDelete,
}: {
  documentId: string;
  file: DocumentFile;
  readOnly?: boolean;
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
        {file.role === 'signed-digital' && file.sealed ? (
          <Chip size="small" variant="outlined" label="Pieczęć" />
        ) : null}
        {readOnly ? (
          <Chip size="small" variant="outlined" label={FILE_ROLE_LABELS[file.role]} />
        ) : (
          <>
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
          </>
        )}
        {!readOnly && canSignPdfFile(file) ? (
          <Button
            variant="contained"
            size="small"
            onClick={() => onSign(file)}
          >
            Podpisz
          </Button>
        ) : null}
        {readOnly ? null : (
          <>
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
          </>
        )}
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
  readOnly = false,
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
  readOnly?: boolean;
  onUpload: (file: File, role: DocumentFileRole) => void;
  onSign: (file: DocumentFile) => void;
  onMove: (file: DocumentFile) => void;
  onDelete: (file: DocumentFile) => void;
}) => {
  const acceptFile = (file: File | undefined) => {
    if (file) onUpload(file, role);
  };
  return (
    <Paper component="section" variant="outlined" sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Typography variant="h3" component="h3">
            {FILE_ROLE_LABELS[role]}
          </Typography>
          {files.length ? <Chip size="small" label={files.length} /> : null}
        </Stack>
        {readOnly ? null : (
          <Button component="label" variant="outlined" size="small" disabled={uploading}>
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
        )}
      </Stack>
      {readOnly ? null : (
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
      )}
      {!readOnly && uploading ? (
        <LinearProgress
          aria-label={`Wgrywanie: ${FILE_ROLE_LABELS[role]}`}
          sx={{ mt: 2 }}
        />
      ) : null}
      {!readOnly && uploadError ? <Alert sx={{ mt: 2 }}>{uploadError}</Alert> : null}
      {files.length ? (
        <List disablePadding sx={{ mt: 1 }}>
          {files.map((file) => (
            <FileRow
              key={file.id}
              documentId={documentId}
              file={file}
              readOnly={readOnly}
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
  const search = useSearch({ from: '/app/documents/$id' });
  const queryClient = useQueryClient();
  const documentQuery = useQuery(actions.document(documentId));
  const folderDocuments = useQuery(actions.documents({ draft: 'all' }));
  const documentLinksQuery = useQuery(actions.documentLinks(documentId));
  const documentCommentsQuery = useQuery(actions.documentComments(documentId));
  const identityQuery = useQuery(actions.me);
  const signatureRecordsQuery = useQuery(actions.signatureRecords(documentId));
  const sourceUpdateRequestQuery = useQuery(
    actions.activeSourceUpdateRequest(documentId),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [detailActionsAnchor, setDetailActionsAnchor] = useState<HTMLElement | null>(null);
  const [deleteDocumentOpen, setDeleteDocumentOpen] = useState(false);
  const [purgeDocumentOpen, setPurgeDocumentOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<DocumentFile>();
  const [fileToMove, setFileToMove] = useState<DocumentFile>();
  const [moveTitle, setMoveTitle] = useState('');
  const [moveDocType, setMoveDocType] = useState<DocumentType>('umowa-uod');
  const [uploadingRole, setUploadingRole] = useState<DocumentFileRole>();
  const [sourceUpdateOpen, setSourceUpdateOpen] = useState(false);
  const [documentLinkOpen, setDocumentLinkOpen] = useState(false);
  const [documentLinkSearch, setDocumentLinkSearch] = useState('');
  const [documentLinkTargetId, setDocumentLinkTargetId] = useState('');
  const [documentLinkLabel, setDocumentLinkLabel] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [sourceUpdatePending, setSourceUpdatePending] = useState(false);
  const [sourceUpdateError, setSourceUpdateError] = useState<string>();
  const [uploadErrors, setUploadErrors] = useState<
    Partial<Record<DocumentFileRole, string>>
  >({});
  const documentsSearch = documentsSearchFromState(
    documentsViewFromSearch(search),
    documentFiltersFromSearch(search),
  );
  const updateDocument = useMutation({
    ...actions.updateDocument,
    onSuccess: async () => {
      setEditOpen(false);
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const approveDocument = useMutation({
    ...actions.approveDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const unapproveDocument = useMutation({
    ...actions.unapproveDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const waiveDocumentSignature = useMutation({
    ...actions.waiveDocumentSignature,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const requireDocumentSignature = useMutation({
    ...actions.requireDocumentSignature,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const deleteDocument = useMutation({
    ...actions.deleteDocument,
    onSuccess: async () => {
      await navigate({ to: '/app/documents', search: documentsSearch });
      queryClient.removeQueries(actions.document(documentId));
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const restoreDocument = useMutation({
    ...actions.restoreDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentsInvalidates());
    },
  });
  const purgeDocument = useMutation({
    ...actions.purgeDocument,
    onSuccess: async () => {
      await navigate({ to: '/app/documents', search: documentsSearch });
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
  const createSourceUpdate = useMutation(actions.createSourceUpdateRequest);
  const decideSourceUpdate = useMutation(actions.decideSourceUpdateRequest);
  const cancelSourceUpdate = useMutation(actions.cancelSourceUpdateRequest);
  const completeSourceUpdate = useMutation(actions.completeSourceUpdateRequest);
  const linkDocuments = useMutation({
    ...actions.linkDocuments,
    onSuccess: async () => {
      setDocumentLinkOpen(false);
      setDocumentLinkSearch('');
      setDocumentLinkTargetId('');
      setDocumentLinkLabel('');
      await queryClient.invalidateQueries(actions.documentLinksInvalidates());
    },
  });
  const unlinkDocuments = useMutation({
    ...actions.unlinkDocuments,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentLinksInvalidates());
    },
  });
  const addDocumentComment = useMutation({
    ...actions.addDocumentComment,
    onSuccess: async () => {
      setCommentBody('');
      await queryClient.invalidateQueries(actions.documentCommentsInvalidates(documentId));
    },
  });
  const deleteDocumentComment = useMutation({
    ...actions.deleteDocumentComment,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.documentCommentsInvalidates(documentId));
    },
  });

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
  const isTrashed = document.deletedAt !== null;
  const isDraft = document.draft;
  const activeSourceUpdate = sourceUpdateRequestQuery.data?.request ?? null;
  const signatureRecords = signatureRecordsQuery.data?.items ?? [];
  const signedDigitalExists = document.files.some(
    (file) => file.role === 'signed-digital',
  );
  const legacySignedWithoutRecords =
    signedDigitalExists &&
    signatureRecordsQuery.isSuccess &&
    signatureRecords.length === 0;
  const sourceUpdateEnabled =
    !isTrashed &&
    !activeSourceUpdate &&
    signatureRecordsQuery.isSuccess &&
    !legacySignedWithoutRecords;
  const currentUserId = identityQuery.data?.userId;
  const currentApproval = activeSourceUpdate?.approvals.find(
    (approval) => approval.approverId === currentUserId,
  );
  const grouped = filesByRole(document.files);
  const personOptions = uniqueDocumentPersons(folderDocuments.data?.documents ?? [document]);
  const tagOptions = uniqueDocumentTags(folderDocuments.data?.documents ?? [document]);
  const linkedDocuments = documentLinksQuery.data?.links ?? [];
  const comments = documentCommentsQuery.data?.items ?? [];
  const linkedDocumentIds = new Set(
    linkedDocuments.map((link) => link.document.id),
  );
  const normalizedDocumentLinkSearch = documentLinkSearch.trim().toLocaleLowerCase('pl');
  const documentLinkCandidates = (folderDocuments.data?.documents ?? []).filter(
    (candidate) =>
      candidate.id !== documentId &&
      !linkedDocumentIds.has(candidate.id) &&
      candidate.title.toLocaleLowerCase('pl').includes(normalizedDocumentLinkSearch),
  );
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
  const sourceUpdateTransport = {
    request: (input: Parameters<typeof requestUpload.mutateAsync>[0]['input']) =>
      requestUpload.mutateAsync({ documentId, input }),
    direct: (input: Parameters<typeof directUpload.mutateAsync>[0]) =>
      directUpload.mutateAsync(input),
    finalize: (input: Parameters<typeof finalizeUpload.mutateAsync>[0]['input']) =>
      finalizeUpload.mutateAsync({ documentId, input }),
    server: (input: Parameters<typeof serverUpload.mutateAsync>[0]['input']) =>
      serverUpload.mutateAsync({ documentId, input }),
  };
  const invalidateSourceUpdate = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.documentsInvalidates()),
      queryClient.invalidateQueries(actions.signatureRecordsInvalidates(documentId)),
      queryClient.invalidateQueries(actions.sourceUpdateRequestsInvalidates()),
    ]);
  };
  const completeReadySourceUpdate = async (request: SourceUpdateRequest) => {
    if (!sourceUpdateReadyToComplete(request)) return;
    let signedFileId: string | undefined;
    if (sourceUpdateNeedsReplay(request, signatureRecords.length)) {
      const source = await queryClient.fetchQuery(
        actions.documentFile(documentId, request.newSourceFileId),
      );
      const signedBytes = await replaySignatureRecordsPdf(
        source.bytes,
        signatureRecords,
      );
      const buffer = new ArrayBuffer(signedBytes.byteLength);
      new Uint8Array(buffer).set(signedBytes);
      const output = new File(
        [buffer],
        `${source.fileName.replace(/\.pdf$/iu, '') || 'dokument'}-podpisany.pdf`,
        { type: 'application/pdf' },
      );
      const uploaded = await uploadDocumentFile(output, 'other', sourceUpdateTransport);
      signedFileId = uploaded.id;
    }
    await completeSourceUpdate.mutateAsync({
      requestId: request.id,
      input: signedFileId ? { signedFileId } : {},
    });
    await invalidateSourceUpdate();
  };
  const submitSourceUpdate = async (
    file: File,
    mode: 'delete-signed' | 'transfer',
  ) => {
    setSourceUpdatePending(true);
    setSourceUpdateError(undefined);
    try {
      const staged = await uploadDocumentFile(file, 'other', sourceUpdateTransport);
      const created = await createSourceUpdate.mutateAsync({
        documentId,
        input: { newSourceFileId: staged.id, mode },
      });
      if (sourceUpdateReadyToComplete(created.request)) {
        await completeReadySourceUpdate(created.request);
      } else {
        await invalidateSourceUpdate();
      }
      setSourceUpdateOpen(false);
    } catch (error) {
      setSourceUpdateError(uploadErrorMessage(error));
    } finally {
      setSourceUpdatePending(false);
    }
  };
  const decideActiveSourceUpdate = async (decision: 'accept' | 'reject') => {
    if (!activeSourceUpdate) return;
    setSourceUpdatePending(true);
    setSourceUpdateError(undefined);
    try {
      const decided = await decideSourceUpdate.mutateAsync({
        requestId: activeSourceUpdate.id,
        input: { decision },
      });
      if (decision === 'accept' && sourceUpdateReadyToComplete(decided.request)) {
        await completeReadySourceUpdate(decided.request);
      } else {
        await invalidateSourceUpdate();
      }
    } catch (error) {
      setSourceUpdateError(uploadErrorMessage(error));
    } finally {
      setSourceUpdatePending(false);
    }
  };
  const cancelActiveSourceUpdate = async () => {
    if (!activeSourceUpdate) return;
    setSourceUpdatePending(true);
    setSourceUpdateError(undefined);
    try {
      await cancelSourceUpdate.mutateAsync(activeSourceUpdate.id);
      await invalidateSourceUpdate();
    } catch (error) {
      setSourceUpdateError(uploadErrorMessage(error));
    } finally {
      setSourceUpdatePending(false);
    }
  };
  const startMove = (file: DocumentFile) => {
    setFileToMove(file);
    setMoveTitle(fileNameStem(file.fileName));
    setMoveDocType(document.docType);
  };

  return (
    <PageContainer>
      <Button
        size="small"
        color="inherit"
        onClick={() => void navigate({ to: '/app/documents', search: documentsSearch })}
      >
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
            {isDraft ? <Chip color="warning" variant="outlined" label="Szkic" /> : null}
            {document.signatureNotRequired ? (
              <Chip size="small" variant="outlined" label="Nie wymaga" />
            ) : null}
          </Stack>
          <Stack sx={{ mt: 1.5, gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Data podpisania: {formatPolishDate(document.documentDate)}
            </Typography>
            {period ? (
              <Typography variant="body2" color="text.secondary">
                Okres: {period}
              </Typography>
            ) : null}
            <Typography variant="body2">
              {document.person ?? 'Bez przypisanej osoby'}
            </Typography>
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
          {isTrashed ? (
            <>
              <Button
                variant="contained"
                disabled={restoreDocument.isPending || purgeDocument.isPending}
                onClick={() => restoreDocument.mutate(documentId)}
              >
                Przywróć
              </Button>
              <Button
                variant="outlined"
                color="error"
                disabled={restoreDocument.isPending || purgeDocument.isPending}
                onClick={() => setPurgeDocumentOpen(true)}
              >
                Usuń trwale
              </Button>
            </>
          ) : (
            <>
              {isDraft ? (
                <NoWrapButton
                  variant="contained"
                  disabled={approveDocument.isPending}
                  onClick={() => approveDocument.mutate(documentId)}
                >
                  Zatwierdź
                </NoWrapButton>
              ) : (
                <NoWrapButton
                  variant="outlined"
                  disabled={unapproveDocument.isPending}
                  onClick={() => unapproveDocument.mutate(documentId)}
                >
                  Cofnij do szkicu
                </NoWrapButton>
              )}
              {document.signatureNotRequired ? (
                <NoWrapButton
                  variant="outlined"
                  disabled={requireDocumentSignature.isPending}
                  onClick={() => requireDocumentSignature.mutate(documentId)}
                >
                  Wymaga podpisu
                </NoWrapButton>
              ) : (
                <NoWrapButton
                  variant="contained"
                  disabled={waiveDocumentSignature.isPending}
                  onClick={() => waiveDocumentSignature.mutate(documentId)}
                >
                  Nie wymaga podpisu
                </NoWrapButton>
              )}
              <NoWrapButton variant="contained" onClick={() => setEditOpen(true)}>
                Edytuj
              </NoWrapButton>
              <IconButton
                size="small"
                aria-label="Więcej akcji"
                onClick={(event) => setDetailActionsAnchor(event.currentTarget)}
              >
                <MoreVertIcon />
              </IconButton>
            </>
          )}
        </Stack>
      </Stack>

      <Menu
        anchorEl={detailActionsAnchor}
        open={Boolean(detailActionsAnchor)}
        onClose={() => setDetailActionsAnchor(null)}
      >
        {sourceUpdateEnabled ? (
          <MenuItem
            onClick={() => {
              setDetailActionsAnchor(null);
              setSourceUpdateError(undefined);
              setSourceUpdateOpen(true);
            }}
          >
            Uaktualnij źródło
          </MenuItem>
        ) : (
          <Tooltip
            title={
              legacySignedWithoutRecords
                ? 'Brak zapisu podpisów — dokumenty podpisane przed włączeniem zapisu wymagają ponownego podpisania.'
                : activeSourceUpdate
                  ? 'Aktualizacja źródła jest już w toku.'
                  : ''
            }
          >
            <span>
              <MenuItem disabled>Uaktualnij źródło</MenuItem>
            </span>
          </Tooltip>
        )}
        <MenuItem
          onClick={() => {
            setDetailActionsAnchor(null);
            setDeleteDocumentOpen(true);
          }}
        >
          <Typography color="error">Usuń dokument</Typography>
        </MenuItem>
      </Menu>

      {isTrashed ? (
        <Alert severity="warning" sx={{ mt: 3 }}>
          W koszu. Dokument można przywrócić albo usunąć trwale. Podgląd,
          pobieranie, podpisywanie, edycja, eksport i wgrywanie plików są
          wyłączone.
        </Alert>
      ) : null}
      {!isTrashed && isDraft ? (
        <Alert severity="info" sx={{ mt: 3 }}>
          Szkic. Dokument jest widoczny w filtrze szkiców i czeka na zatwierdzenie.
        </Alert>
      ) : null}
      {!isTrashed && activeSourceUpdate ? (
        <Alert
          severity="info"
          sx={{ mt: 3 }}
          action={
            <Stack direction="row" sx={{ gap: 1 }}>
              {currentApproval?.decision === 'pending' ? (
                <>
                  <Button
                    color="inherit"
                    disabled={sourceUpdatePending}
                    onClick={() => void decideActiveSourceUpdate('accept')}
                  >
                    Zaakceptuj
                  </Button>
                  <Button
                    color="inherit"
                    disabled={sourceUpdatePending}
                    onClick={() => void decideActiveSourceUpdate('reject')}
                  >
                    Odrzuć
                  </Button>
                </>
              ) : null}
              {activeSourceUpdate.requestedBy === currentUserId ? (
                <Button
                  color="inherit"
                  disabled={sourceUpdatePending}
                  onClick={() => void cancelActiveSourceUpdate()}
                >
                  Anuluj wniosek
                </Button>
              ) : null}
            </Stack>
          }
        >
          Aktualizacja źródła oczekuje na akceptację wymaganych podpisujących.
        </Alert>
      ) : null}
      {sourceUpdateError && !sourceUpdateOpen ? (
        <Alert severity="error" sx={{ mt: 2 }}>{sourceUpdateError}</Alert>
      ) : null}
      {approveDocument.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {approveDocument.error.message}
        </Alert>
      ) : null}
      {unapproveDocument.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {unapproveDocument.error.message}
        </Alert>
      ) : null}
      {waiveDocumentSignature.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {waiveDocumentSignature.error.message}
        </Alert>
      ) : null}
      {requireDocumentSignature.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {requireDocumentSignature.error.message}
        </Alert>
      ) : null}
      {restoreDocument.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {restoreDocument.error.message}
        </Alert>
      ) : null}
      {purgeDocument.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {purgeDocument.error.message}
        </Alert>
      ) : null}
      <Paper variant="outlined" sx={{ mt: 4, p: 3 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
        >
          <Typography variant="h2" component="h2">
            Powiązane dokumenty
          </Typography>
          {!isTrashed ? (
            <Button variant="outlined" onClick={() => setDocumentLinkOpen(true)}>
              Dodaj powiązanie
            </Button>
          ) : null}
        </Stack>
        {documentLinksQuery.isPending ? (
          <LinearProgress sx={{ mt: 2 }} />
        ) : documentLinksQuery.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {documentLinksQuery.error.message}
          </Alert>
        ) : linkedDocuments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Brak powiązanych dokumentów.
          </Typography>
        ) : (
          <List disablePadding sx={{ mt: 1 }}>
            {linkedDocuments.map((link) => (
              <ListItem
                key={link.linkId}
                disablePadding
                divider
                secondaryAction={
                  !isTrashed ? (
                    <Button
                      color="error"
                      size="small"
                      disabled={unlinkDocuments.isPending}
                      onClick={() =>
                        unlinkDocuments.mutate({
                          documentId,
                          otherDocumentId: link.document.id,
                        })
                      }
                    >
                      Usuń
                    </Button>
                  ) : null
                }
                sx={{ opacity: link.document.deletedAt ? 0.55 : 1 }}
              >
                <ListItemButton
                  onClick={() =>
                    void navigate({
                      to: '/app/documents/$id',
                      params: { id: link.document.id },
                    })
                  }
                >
                  <ListItemText primary={link.document.title} />
                  <Stack direction="row" sx={{ gap: 1, mr: isTrashed ? 0 : 8 }}>
                    {link.label ? <Chip size="small" label={link.label} /> : null}
                    {link.document.deletedAt ? (
                      <Chip size="small" variant="outlined" label="W koszu" />
                    ) : null}
                  </Stack>
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {unlinkDocuments.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {unlinkDocuments.error.message}
          </Alert>
        ) : null}
      </Paper>
      <Paper component="section" variant="outlined" sx={{ mt: 3, p: 3 }}>
        <Typography variant="h2" component="h2">
          Komentarze
        </Typography>
        {documentCommentsQuery.isPending ? (
          <LinearProgress sx={{ mt: 2 }} />
        ) : documentCommentsQuery.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {documentCommentsQuery.error.message}
          </Alert>
        ) : comments.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Brak komentarzy.
          </Typography>
        ) : (
          <List disablePadding sx={{ mt: 1 }}>
            {comments.map((comment) => (
              <ListItem
                key={comment.id}
                disableGutters
                divider
                secondaryAction={
                  !isTrashed && comment.author.accountId === currentUserId ? (
                    <Tooltip title="Usuń komentarz" describeChild disableInteractive>
                      <IconButton
                        aria-label={`Usuń komentarz ${comment.id}`}
                        color="error"
                        size="small"
                        disabled={deleteDocumentComment.isPending}
                        onClick={() =>
                          deleteDocumentComment.mutate({
                            documentId,
                            commentId: comment.id,
                          })
                        }
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  ) : null
                }
                sx={{ alignItems: 'flex-start', py: 1.5 }}
              >
                <Box sx={{ flex: 1, mr: comment.author.accountId === currentUserId ? 5 : 0 }}>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    <Typography component="span" variant="subtitle1">
                      {comment.author.name}
                    </Typography>
                    <Typography component="time" variant="body2" color="text.secondary">
                      {formatPolishDateTime(comment.createdAt)}
                    </Typography>
                  </Stack>
                  <DocumentCommentBody variant="body2">
                    {comment.body}
                  </DocumentCommentBody>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
        {!isTrashed ? (
          <Stack sx={{ mt: 2.5, gap: 1.5, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Komentarz"
              value={commentBody}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              onChange={(event) => setCommentBody(event.target.value)}
            />
            <Button
              variant="contained"
              disabled={!commentBody.trim() || addDocumentComment.isPending}
              onClick={() =>
                addDocumentComment.mutate({
                  documentId,
                  input: { body: commentBody },
                })
              }
            >
              Dodaj komentarz
            </Button>
          </Stack>
        ) : null}
        {addDocumentComment.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {addDocumentComment.error.message}
          </Alert>
        ) : null}
        {deleteDocumentComment.isError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {deleteDocumentComment.error.message}
          </Alert>
        ) : null}
      </Paper>
      <Divider sx={{ my: 4 }} />
      <Typography variant="h2" component="h2" sx={{ mb: 3 }}>
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
            readOnly={isTrashed}
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
          tags: document.tags,
        }}
        pending={updateDocument.isPending}
        error={updateDocument.error?.message}
        personOptions={personOptions}
        tagOptions={tagOptions}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) =>
          updateDocument.mutate({
            documentId,
            input: toDocumentInput(values),
          })
        }
      />
      <SourceUpdateDialog
        open={sourceUpdateOpen}
        pending={sourceUpdatePending}
        error={sourceUpdateError}
        onClose={() => setSourceUpdateOpen(false)}
        onSubmit={(file, mode) => void submitSourceUpdate(file, mode)}
      />
      <Dialog
        open={documentLinkOpen}
        onClose={linkDocuments.isPending ? undefined : () => setDocumentLinkOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Dodaj powiązany dokument</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <TextField
              label="Szukaj po tytule"
              value={documentLinkSearch}
              onChange={(event) => setDocumentLinkSearch(event.target.value)}
            />
            <List sx={{ maxHeight: 240, overflow: 'auto' }}>
              {documentLinkCandidates.map((candidate) => (
                <ListItemButton
                  key={candidate.id}
                  selected={documentLinkTargetId === candidate.id}
                  onClick={() => setDocumentLinkTargetId(candidate.id)}
                >
                  <ListItemText primary={candidate.title} />
                </ListItemButton>
              ))}
              {documentLinkCandidates.length === 0 ? (
                <ListItem>
                  <ListItemText primary="Brak dokumentów do powiązania." />
                </ListItem>
              ) : null}
            </List>
            <TextField
              label="Etykieta (opcjonalnie)"
              value={documentLinkLabel}
              slotProps={{ htmlInput: { maxLength: 60 } }}
              onChange={(event) => setDocumentLinkLabel(event.target.value)}
            />
            {linkDocuments.isError ? (
              <Alert severity="error">{linkDocuments.error.message}</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDocumentLinkOpen(false)}
            disabled={linkDocuments.isPending}
          >
            Anuluj
          </Button>
          <Button
            variant="contained"
            disabled={!documentLinkTargetId || linkDocuments.isPending}
            onClick={() =>
              linkDocuments.mutate({
                documentId,
                input: {
                  otherDocumentId: documentLinkTargetId,
                  ...(documentLinkLabel.trim()
                    ? { label: documentLinkLabel.trim() }
                    : {}),
                },
              })
            }
          >
            Dodaj
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={deleteDocumentOpen}
        title="Przenieść dokument do kosza?"
        text="Dokument trafi do kosza. Możesz go później przywrócić."
        confirmLabel="Przenieś do kosza"
        pending={deleteDocument.isPending}
        onCancel={() => setDeleteDocumentOpen(false)}
        onConfirm={() => deleteDocument.mutate(documentId)}
      />
      <ConfirmDialog
        open={purgeDocumentOpen}
        title="Usunąć trwale?"
        text={`Dokument „${document.title}” i wszystkie jego pliki zostaną trwale usunięte z magazynu blob. Tej operacji nie można cofnąć.`}
        confirmLabel="Usuń trwale"
        pending={purgeDocument.isPending}
        onCancel={() => setPurgeDocumentOpen(false)}
        onConfirm={() => purgeDocument.mutate(documentId)}
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
