import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { passwordSchema } from '../../lib/password.js';
import { Eyebrow, FinePrint, Wordmark } from '../../theme.js';

const passwordFormSchema = z
  .object({ password: passwordSchema, confirmation: z.string() })
  .refine((value) => value.password === value.confirmation, {
    path: ['confirmation'],
    message: 'Hasła muszą być takie same',
  });

export const invitationAcceptanceErrorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

export const InvitationAcceptPage = ({ token }: { token: string }) => {
  const invitation = useQuery(actions.publicInvitation(token));
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/app' });
    },
  });
  const accept = useMutation({
    ...actions.acceptInvitation,
    onSuccess: ({ email }) => {
      signIn.mutate({ email, password });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordFormSchema.safeParse({ password, confirmation });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setPasswordError(fields.password?.[0] ?? null);
      setConfirmationError(fields.confirmation?.[0] ?? null);
      return;
    }
    setPasswordError(null);
    setConfirmationError(null);
    accept.mutate({ token, input: { password: parsed.data.password } });
  };

  const details = invitation.data?.invitation;
  const formError = accept.error ?? signIn.error;

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        noValidate
        sx={{ width: '100%', maxWidth: '28rem', px: '2rem', pt: '2.2rem', pb: '1.8rem' }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>Podpisy</Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>
          Przyjmij zaproszenie
        </Eyebrow>
        {invitation.isPending ? <Typography variant="body2">Sprawdzanie zaproszenia…</Typography> : null}
        {invitation.isError ? (
          <Alert severity="error">To zaproszenie jest nieprawidłowe, wygasło lub zostało unieważnione.</Alert>
        ) : null}
        {details ? (
          <Stack useFlexGap spacing="1rem">
            <Box>
              <Typography variant="body2" color="text.secondary">Archiwum</Typography>
              <Typography variant="h2">{details.organizationName}</Typography>
              <Typography variant="body2" sx={{ mt: '0.35rem' }}>{details.email}</Typography>
            </Box>
            <FormControl fullWidth error={Boolean(passwordError)}>
              <FormLabel htmlFor="invitation-password">Ustaw hasło</FormLabel>
              <OutlinedInput
                id="invitation-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
              {passwordError ? <FormHelperText>{passwordError}</FormHelperText> : null}
            </FormControl>
            <FormControl fullWidth error={Boolean(confirmationError)}>
              <FormLabel htmlFor="invitation-password-confirmation">Powtórz hasło</FormLabel>
              <OutlinedInput
                id="invitation-password-confirmation"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
              />
              {confirmationError ? <FormHelperText>{confirmationError}</FormHelperText> : null}
            </FormControl>
            <Button type="submit" variant="contained" disabled={accept.isPending || signIn.isPending}>
              {accept.isPending || signIn.isPending ? 'Dołączanie…' : 'Dołącz do archiwum'}
            </Button>
            {formError ? <Alert severity="error">{invitationAcceptanceErrorText(formError)}</Alert> : null}
          </Stack>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p">
          Klucz dostępu i uwierzytelnianie dwuskładnikowe możesz dodać później w Konto.
        </FinePrint>
      </Paper>
    </Box>
  );
};
