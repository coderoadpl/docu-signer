import { useState } from 'react';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Something went wrong';

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
      <Typography variant="overline">two-factor authentication (TOTP)</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Add a time-based one-time code from an authenticator app as a second factor.
      </Typography>

      {enrolment === null ? (
        <Stack useFlexGap spacing="0.8rem">
          <FormControl>
            <FormLabel htmlFor="tfa-password">account password</FormLabel>
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
              {enable.isPending ? 'enabling…' : 'enable 2FA'}
            </Button>
          </Box>
          {enable.isError ? <Alert>{errorText(enable.error)}</Alert> : null}
        </Stack>
      ) : (
        <Stack useFlexGap spacing="0.8rem">
          <Typography variant="body2">
            Scan this URI in your authenticator, then enter a code to confirm:
          </Typography>
          <OutlinedInput readOnly value={enrolment.totpURI} inputProps={{ 'aria-label': 'totp enrolment uri' }} />
          <FormControl>
            <FormLabel htmlFor="tfa-code">authenticator code</FormLabel>
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
              {verify.isPending ? 'verifying…' : 'verify code'}
            </Button>
          </Box>
          {verify.isSuccess ? <Alert severity="success">Two-factor authentication is enabled.</Alert> : null}
          {verify.isError ? <Alert>{errorText(verify.error)}</Alert> : null}
          <Box>
            <Button
              variant="text"
              color="error"
              disabled={disable.isPending || password.length === 0}
              onClick={() => disable.mutate({ password })}
            >
              disable 2FA
            </Button>
          </Box>
          {disable.isError ? <Alert>{errorText(disable.error)}</Alert> : null}
        </Stack>
      )}
    </Paper>
  );
};
