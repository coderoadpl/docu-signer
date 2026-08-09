import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { passwordSchema } from '../../lib/password.js';
import { Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const resetPasswordSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

const newPasswordSchema = z
  .object({ newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Hasła muszą być takie same',
  });

type Field = 'newPassword' | 'confirmPassword';
type FieldErrors = Record<Field, string | undefined>;
const NO_FIELD_ERRORS: FieldErrors = { newPassword: undefined, confirmPassword: undefined };
const SIGN_IN_REDIRECT_MS = 2000;

const Card = ({ children }: { children: ReactNode }) => (
  <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
    <Paper
      variant="outlined"
      sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem', animation: 'settle 0.45s ease-out both' }}
    >
      <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
        Podpisy
      </Wordmark>
      {children}
    </Paper>
  </Box>
);

export const ResetPasswordPage = () => {
  const search = useSearch({ strict: false });
  const parsedSearch = resetPasswordSearchSchema.safeParse(search);
  const token = parsedSearch.success && !parsedSearch.data.error ? parsedSearch.data.token : undefined;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);
  const navigate = useNavigate();

  const resetPassword = useMutation(actions.resetPassword);
  const done = resetPassword.isSuccess;

  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => {
      void navigate({ to: '/login' });
    }, SIGN_IN_REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [done, navigate]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token === undefined) return;
    const parsed = newPasswordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setClientErrors({
        newPassword: flat.newPassword?.[0],
        confirmPassword: flat.confirmPassword?.[0],
      });
      return;
    }
    setClientErrors(NO_FIELD_ERRORS);
    resetPassword.mutate({ token, newPassword: parsed.data.newPassword });
  };

  if (token === undefined) {
    return (
      <Card>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          Reset hasła
        </Eyebrow>
        <Alert severity="error">Ten link resetowania jest nieprawidłowy albo wygasł.</Alert>
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <Eyebrow variant="caption" component="p">
          <Link href="/forgot-password">Poproś o nowy link</Link>
        </Eyebrow>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          Reset hasła
        </Eyebrow>
        <Alert severity="success">Hasło zostało zmienione. Za chwilę wrócisz do logowania.</Alert>
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <Eyebrow variant="caption" component="p">
          <Link href="/login">Zaloguj się teraz</Link>
        </Eyebrow>
      </Card>
    );
  }

  const formError = resetPassword.isError
    ? resetPassword.error instanceof ApiError
      ? resetPassword.error.appError.message
      : resetPassword.error.message
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
          Ustaw nowe hasło
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth error={Boolean(clientErrors.newPassword)}>
            <FormLabel htmlFor="reset-password">Nowe hasło</FormLabel>
            <OutlinedInput
              id="reset-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            {clientErrors.newPassword ? <FormHelperText>{clientErrors.newPassword}</FormHelperText> : null}
          </FormControl>
          <FormControl fullWidth error={Boolean(clientErrors.confirmPassword)}>
            <FormLabel htmlFor="reset-password-confirm">Powtórz hasło</FormLabel>
            <OutlinedInput
              id="reset-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            {clientErrors.confirmPassword ? <FormHelperText>{clientErrors.confirmPassword}</FormHelperText> : null}
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={resetPassword.isPending}
            sx={{ mt: '0.4rem' }}
          >
            {resetPassword.isPending ? 'Zapisywanie…' : 'Ustaw nowe hasło'}
          </Button>
        </Stack>
        {formError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{formError}</Alert> : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p">
          Hasło musi mieć co najmniej 8 znaków.
        </FinePrint>
      </Paper>
    </Box>
  );
};
