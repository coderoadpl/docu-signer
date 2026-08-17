import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
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
import {
  uniqueDocumentPersons,
  uniqueDocumentTags,
  visibleFilterValues,
  type HiddenFilterKind,
} from '#core/domain/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

const KIND_LABELS: Record<HiddenFilterKind, string> = {
  person: 'Strona',
  tag: 'Tag',
};

export const HiddenFilterValuesSection = () => {
  const queryClient = useQueryClient();
  const hiddenFilterValues = useQuery(actions.hiddenFilterValues);
  const documents = useQuery(actions.documents({ draft: 'all' }));
  const [drafts, setDrafts] = useState<Record<HiddenFilterKind, string>>({
    person: '',
    tag: '',
  });
  const invalidate = async () => {
    await Promise.all(
      actions.hiddenFilterValuesInvalidates().map((filters) =>
        queryClient.invalidateQueries(filters),
      ),
    );
  };
  const hide = useMutation({
    ...actions.hideFilterValue,
    onSuccess: async (_data, variables) => {
      setDrafts((current) => ({ ...current, [variables.kind]: '' }));
      await invalidate();
    },
  });
  const unhide = useMutation({
    ...actions.unhideFilterValue,
    onSuccess: invalidate,
  });
  const pending = hide.isPending || unhide.isPending;
  const error = hide.error ?? unhide.error ?? hiddenFilterValues.error;
  const hiddenValues = hiddenFilterValues.data?.hiddenFilterValues ?? [];
  const allDocuments = documents.data?.documents ?? [];
  const optionsByKind: Record<HiddenFilterKind, string[]> = {
    person: uniqueDocumentPersons(allDocuments),
    tag: uniqueDocumentTags(allDocuments),
  };

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Ukryte wartości filtrów</Typography>
      <Typography variant="body2" color="text.secondary">
        Ukryta strona lub tag znika z podpowiedzi i list filtrów. Dokumenty
        zachowują swoje wartości.
      </Typography>
      {(['person', 'tag'] as const).map((kind) => {
        const hiddenForKind = hiddenValues.filter((entry) => entry.kind === kind);
        return (
          <Stack key={kind} sx={{ mt: 2, gap: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1 }}>
              <Autocomplete
                freeSolo
                options={visibleFilterValues(optionsByKind[kind], hiddenValues, kind)}
                value={drafts[kind]}
                onChange={(_event, value) =>
                  setDrafts((current) => ({ ...current, [kind]: value ?? '' }))
                }
                onInputChange={(_event, value) =>
                  setDrafts((current) => ({ ...current, [kind]: value }))
                }
                sx={{ flex: 1 }}
                renderInput={(params) => (
                  <TextField {...params} size="small" label={KIND_LABELS[kind]} />
                )}
              />
              <Button
                variant="contained"
                disabled={pending || !drafts[kind].trim()}
                onClick={() => hide.mutate({ kind, value: drafts[kind].trim() })}
              >
                Ukryj
              </Button>
            </Stack>
            {hiddenForKind.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Brak ukrytych wartości.
              </Typography>
            ) : (
              <List disablePadding>
                {hiddenForKind.map((entry) => (
                  <ListItem
                    key={entry.id}
                    disableGutters
                    secondaryAction={
                      <Button
                        size="small"
                        disabled={pending}
                        onClick={() => unhide.mutate({ kind, value: entry.value })}
                      >
                        Przywróć
                      </Button>
                    }
                  >
                    <ListItemText primary={entry.value} secondary={KIND_LABELS[kind]} />
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        );
      })}
      {error ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          {errorText(error)}
        </Alert>
      ) : null}
    </Paper>
  );
};
