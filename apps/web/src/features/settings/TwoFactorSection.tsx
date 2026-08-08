import { useState } from 'react';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd';

/**
 * US-028a TOTP 2FA settings (web). Enable (re-auth with the password) → show the
 * otpauth URI + backup codes → verify a code from the authenticator to confirm
 * enrolment; disable with the password. Every provider call goes through
 * `AuthClientPort`, so this component names no auth route or SDK.
 */
export const TwoFactorSection = () => {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const enable = useMutation(actions.enableTwoFactor);
  const verify = useMutation({
    ...actions.verifyTotp,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.meInvalidates());
    },
  });
  const disable = useMutation({
    ...actions.disableTwoFactor,
    onSuccess: () => {
      enable.reset();
      verify.reset();
      setPassword('');
      setCode('');
    },
  });

  const enrolment = enable.data ?? null;

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Uwierzytelnianie dwuskładnikowe (TOTP)</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Dodaj jednorazowy kod z aplikacji uwierzytelniającej jako drugi składnik.
      </Typography>

      {enrolment === null ? (
        <Stack useFlexGap spacing="0.8rem">
          <FormControl>
            <FormLabel htmlFor="tfa-password">Hasło do konta</FormLabel>
            <OutlinedInput
              id="tfa-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </FormControl>
          <Box>
            <Button
              variant="contained"
              disabled={enable.isPending || password.length === 0}
              onClick={() => enable.mutate({ password })}
            >
              {enable.isPending ? 'Włączanie…' : 'Włącz 2FA'}
            </Button>
          </Box>
          {enable.isError ? <Alert>{errorText(enable.error)}</Alert> : null}
        </Stack>
      ) : (
        <Stack useFlexGap spacing="0.8rem">
          <Typography variant="body2">
            Zeskanuj ten adres URI w aplikacji uwierzytelniającej, a następnie wpisz kod:
          </Typography>
          <OutlinedInput readOnly value={enrolment.totpURI} inputProps={{ 'aria-label': 'Adres URI konfiguracji TOTP' }} />
          <FormControl>
            <FormLabel htmlFor="tfa-code">Kod z aplikacji</FormLabel>
            <OutlinedInput
              id="tfa-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputProps={{ inputMode: 'numeric' }}
            />
          </FormControl>
          <Box>
            <Button
              variant="contained"
              disabled={verify.isPending || code.length === 0}
              onClick={() => verify.mutate({ code })}
            >
              {verify.isPending ? 'Sprawdzanie…' : 'Sprawdź kod'}
            </Button>
          </Box>
          {verify.isSuccess ? <Alert severity="success">Uwierzytelnianie dwuskładnikowe jest włączone.</Alert> : null}
          {verify.isError ? <Alert>{errorText(verify.error)}</Alert> : null}
          <Box>
            <Button
              variant="text"
              color="error"
              disabled={disable.isPending || password.length === 0}
              onClick={() => disable.mutate({ password })}
            >
              Wyłącz 2FA
            </Button>
          </Box>
          {disable.isError ? <Alert>{errorText(disable.error)}</Alert> : null}
        </Stack>
      )}
    </Paper>
  );
};
