import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  Link,
  OutlinedInput,
  Paper,
  Stack,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { Eyebrow, FinePrint, Wordmark } from '../../theme.js';

const emailSchema = z.string().trim().pipe(z.email('Wpisz prawidłowy adres e-mail'));

export const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  const config = useQuery(actions.config);
  const requestReset = useMutation(actions.requestPasswordReset);
  const resetEnabled = config.data?.passwordResetEnabled === true;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!resetEnabled) return;
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Wpisz prawidłowy adres e-mail');
      return;
    }
    setEmailError(undefined);
    requestReset.mutate({
      email: parsed.data,
      redirectTo: `${window.location.origin}/reset-password`,
    });
  };

  const errorMessage = requestReset.isError
    ? requestReset.error instanceof ApiError
      ? requestReset.error.appError.message
      : requestReset.error.message
    : null;

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        noValidate
        sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem', animation: 'settle 0.45s ease-out both' }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
          Podpisy
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          Przypomnienie hasła
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth error={Boolean(emailError)}>
            <FormLabel htmlFor="forgot-email">Adres e-mail</FormLabel>
            <OutlinedInput
              id="forgot-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
            {emailError ? <FormHelperText>{emailError}</FormHelperText> : null}
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={!resetEnabled || requestReset.isPending}
            sx={{ mt: '0.4rem' }}
          >
            {requestReset.isPending ? 'Wysyłanie linku…' : 'Wyślij link resetowania'}
          </Button>
        </Stack>
        {config.data?.passwordResetEnabled === false ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            Reset hasła nie jest jeszcze skonfigurowany dla tego środowiska.
          </Alert>
        ) : null}
        {requestReset.isSuccess ? (
          <Alert severity="success" sx={{ mt: '0.6rem' }}>
            Jeśli ten adres ma konto, link resetowania został wysłany. W środowisku
            deweloperskim wiadomość znajdziesz w Mailpit.
          </Alert>
        ) : null}
        {errorMessage ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{errorMessage}</Alert> : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p">
          Link wygasa po godzinie i działa tylko raz.
        </FinePrint>
        <Eyebrow variant="caption" component="p" sx={{ mt: '0.9rem' }}>
          Pamiętasz hasło? <Link href="/login">Zaloguj się</Link>
        </Eyebrow>
      </Paper>
    </Box>
  );
};
