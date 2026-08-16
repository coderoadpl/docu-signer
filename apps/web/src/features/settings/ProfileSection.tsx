import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Imię i nazwisko nie może być puste')
  .max(200, 'Imię i nazwisko może mieć maksymalnie 200 znaków');

const errorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

export const ProfileSection = () => {
  const identity = useQuery(actions.me);
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const name = draftName ?? identity.data?.name ?? '';

  const updateUser = useMutation({
    ...actions.updateUser,
    onSuccess: async (_data, input) => {
      setDraftName(input.name);
      setNameError(null);
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });

  const submit = () => {
    updateUser.reset();
    const parsed = displayNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? 'Wpisz prawidłowe imię i nazwisko');
      return;
    }
    setNameError(null);
    updateUser.mutate({ name: parsed.data });
  };

  const disabled = identity.isPending || identity.isError || updateUser.isPending;

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Profil</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Zmień imię i nazwisko wyświetlane w aplikacji.
      </Typography>

      <Stack useFlexGap spacing="0.8rem">
        <FormControl error={nameError !== null}>
          <FormLabel htmlFor="profile-name">Imię i nazwisko</FormLabel>
          <OutlinedInput
            id="profile-name"
            value={name}
            onChange={(event) => setDraftName(event.target.value)}
            autoComplete="name"
            disabled={disabled}
          />
          {nameError === null ? null : <FormHelperText>{nameError}</FormHelperText>}
        </FormControl>
        <Box>
          <Button variant="contained" disabled={disabled} onClick={submit}>
            {updateUser.isPending ? 'Zapisywanie…' : 'Zapisz'}
          </Button>
        </Box>
        {updateUser.isSuccess ? (
          <Alert severity="success">Imię i nazwisko zostało zapisane.</Alert>
        ) : null}
        {updateUser.isError ? <Alert severity="error">{errorText(updateUser.error)}</Alert> : null}
      </Stack>
    </Paper>
  );
};
