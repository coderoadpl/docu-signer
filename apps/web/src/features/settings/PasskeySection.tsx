import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd';

export const PasskeySection = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const passkeys = useQuery(actions.passkeys);

  const register = useMutation({
    ...actions.registerPasskey,
    onSuccess: async () => {
      setName('');
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });

  const remove = useMutation({
    ...actions.removePasskey,
    onSuccess: async () => {
      setConfirmingId(null);
      await queryClient.invalidateQueries(actions.passkeysInvalidates());
    },
  });

  const rows = passkeys.data ?? [];

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Klucze dostępu</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Zarejestruj urządzenie lub klucz bezpieczeństwa, aby logować się bez hasła.
      </Typography>

      <Stack useFlexGap spacing="0.8rem">
        <FormControl>
          <FormLabel htmlFor="passkey-name">Nazwa klucza</FormLabel>
          <OutlinedInput
            id="passkey-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="np. MacBook Touch ID"
          />
        </FormControl>
        <Box>
          <Button
            variant="contained"
            disabled={register.isPending || name.trim().length === 0}
            onClick={() => register.mutate({ name: name.trim() })}
          >
            {register.isPending ? 'Rejestrowanie…' : 'Zarejestruj klucz'}
          </Button>
        </Box>
        {register.isError ? <Alert>{errorText(register.error)}</Alert> : null}
      </Stack>

      {rows.length > 0 ? (
        <List sx={{ mt: '0.8rem' }}>
          {rows.map((passkey) => (
            <ListItem
              key={passkey.id}
              disableGutters
              secondaryAction={
                confirmingId === passkey.id ? (
                  <Stack direction="row" useFlexGap spacing="0.4rem">
                    <Button
                      size="small"
                      color="error"
                      variant="contained"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: passkey.id })}
                    >
                      Potwierdź usunięcie
                    </Button>
                    <Button size="small" variant="text" onClick={() => setConfirmingId(null)}>
                      Anuluj
                    </Button>
                  </Stack>
                ) : (
                  <Button size="small" color="error" variant="text" onClick={() => setConfirmingId(passkey.id)}>
                    Usuń
                  </Button>
                )
              }
            >
              <ListItemText primary={passkey.name.length > 0 ? passkey.name : 'Klucz bez nazwy'} />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" sx={{ mt: '0.8rem' }}>
          Nie zarejestrowano jeszcze żadnych kluczy.
        </Typography>
      )}
      {remove.isError ? <Alert>{errorText(remove.error)}</Alert> : null}
    </Paper>
  );
};
