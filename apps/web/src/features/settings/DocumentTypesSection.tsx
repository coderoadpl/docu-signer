import { useState } from 'react';
import {
  Alert,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

export const DocumentTypesSection = () => {
  const queryClient = useQueryClient();
  const documentTypes = useQuery(actions.documentTypes);
  const [newLabel, setNewLabel] = useState('');
  const [editingSlug, setEditingSlug] = useState<string>();
  const [editingLabel, setEditingLabel] = useState('');
  const invalidate = async () => {
    await Promise.all(
      actions.documentTypesInvalidates().map((filters) =>
        queryClient.invalidateQueries(filters),
      ),
    );
  };
  const create = useMutation({
    ...actions.createDocumentType,
    onSuccess: async () => {
      setNewLabel('');
      await invalidate();
    },
  });
  const rename = useMutation({
    ...actions.renameDocumentType,
    onSuccess: async () => {
      setEditingSlug(undefined);
      setEditingLabel('');
      await invalidate();
    },
  });
  const remove = useMutation({
    ...actions.deleteDocumentType,
    onSuccess: invalidate,
  });
  const setHidden = useMutation({
    ...actions.setDocumentTypeHidden,
    onSuccess: invalidate,
  });
  const pending =
    create.isPending || rename.isPending || remove.isPending || setHidden.isPending;
  const error = create.error ?? rename.error ?? remove.error ?? setHidden.error;

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Typy dokumentów</Typography>
      <Stack
        component="form"
        direction={{ xs: 'column', sm: 'row' }}
        onSubmit={(event) => {
          event.preventDefault();
          if (newLabel.trim()) create.mutate({ label: newLabel });
        }}
        sx={{ mt: 1, gap: 1 }}
      >
        <TextField
          size="small"
          label="Nazwa typu"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          fullWidth
        />
        <Button type="submit" variant="contained" disabled={pending || !newLabel.trim()}>
          Dodaj
        </Button>
      </Stack>
      {documentTypes.isPending ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Ładowanie typów…
        </Typography>
      ) : null}
      {documentTypes.isError ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorText(documentTypes.error)}
        </Alert>
      ) : null}
      {documentTypes.data ? (
        <List disablePadding sx={{ mt: 1 }}>
          {documentTypes.data.documentTypes.map((documentType) => (
            <ListItem
              key={documentType.slug}
              disableGutters
              secondaryAction={
                <Stack direction="row" sx={{ gap: 0.5 }}>
                  {editingSlug === documentType.slug ? (
                    <Button
                      size="small"
                      disabled={pending || !editingLabel.trim()}
                      onClick={() =>
                        rename.mutate({
                          slug: documentType.slug,
                          input: { label: editingLabel },
                        })
                      }
                    >
                      Zapisz
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      disabled={pending}
                      onClick={() => {
                        setEditingSlug(documentType.slug);
                        setEditingLabel(documentType.label);
                      }}
                    >
                      Zmień nazwę
                    </Button>
                  )}
                  <Button
                    size="small"
                    disabled={pending}
                    onClick={() =>
                      setHidden.mutate({
                        slug: documentType.slug,
                        input: { hidden: !documentType.hidden },
                      })
                    }
                  >
                    {documentType.hidden ? 'Przywróć' : 'Ukryj'}
                  </Button>
                  <IconButton
                    aria-label={`Usuń typ ${documentType.label}`}
                    disabled={pending}
                    onClick={() => remove.mutate(documentType.slug)}
                  >
                    ×
                  </IconButton>
                </Stack>
              }
              sx={{ pr: 28, opacity: documentType.hidden ? 0.5 : 1 }}
            >
              {editingSlug === documentType.slug ? (
                <TextField
                  size="small"
                  label="Nazwa typu"
                  value={editingLabel}
                  onChange={(event) => setEditingLabel(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                  fullWidth
                />
              ) : (
                <ListItemText
                  primary={documentType.label}
                  secondary={documentType.hidden ? `${documentType.slug} · ukryty` : documentType.slug}
                />
              )}
            </ListItem>
          ))}
        </List>
      ) : null}
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {errorText(error)}
        </Alert>
      ) : null}
    </Paper>
  );
};
