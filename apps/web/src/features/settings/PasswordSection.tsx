import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { passwordSchema } from '../../lib/password.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd';

export const PasswordSection = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);

  const changePassword = useMutation({
    ...actions.changePassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setRevokeOtherSessions(false);
      setNewPasswordError(null);
    },
  });

  const submit = () => {
    changePassword.reset();
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setNewPasswordError(parsed.error.issues[0]?.message ?? 'Wpisz prawidłowe hasło');
      return;
    }
    setNewPasswordError(null);
    changePassword.mutate({ currentPassword, newPassword: parsed.data, revokeOtherSessions });
  };

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Hasło</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Zmień hasło używane do logowania na to konto.
      </Typography>

      <Stack useFlexGap spacing="0.8rem">
        <FormControl>
          <FormLabel htmlFor="current-password">Obecne hasło</FormLabel>
          <OutlinedInput
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
          />
        </FormControl>
        <FormControl error={newPasswordError !== null}>
          <FormLabel htmlFor="new-password">Nowe hasło</FormLabel>
          <OutlinedInput
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
          {newPasswordError === null ? null : <FormHelperText>{newPasswordError}</FormHelperText>}
        </FormControl>
        <FormControlLabel
          control={
            <Checkbox
              checked={revokeOtherSessions}
              onChange={(event) => setRevokeOtherSessions(event.target.checked)}
            />
          }
          label="Wyloguj inne sesje"
        />
        <Box>
          <Button
            variant="contained"
            disabled={changePassword.isPending || currentPassword.length === 0 || newPassword.length === 0}
            onClick={submit}
          >
            {changePassword.isPending ? 'Zmienianie…' : 'Zmień hasło'}
          </Button>
        </Box>
        {changePassword.isSuccess ? <Alert severity="success">Hasło zostało zmienione.</Alert> : null}
        {changePassword.isError ? <Alert severity="error">{errorText(changePassword.error)}</Alert> : null}
      </Stack>
    </Paper>
  );
};
