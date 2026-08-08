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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { Eyebrow, Wordmark } from '../../theme.js';

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  password: z.string().min(8, 'Use at least 8 characters'),
});

type Field = 'name' | 'email' | 'password';
type FieldErrors = Record<Field, string | undefined>;
const NO_FIELD_ERRORS: FieldErrors = { name: undefined, email: undefined, password: undefined };

/**
 * Reads per-field messages off an `AppError.details` payload shaped like a zod
 * `flatten()` (`{ fieldErrors: Record<string, string[]> }`) — the same envelope
 * a server `validation` error carries — so a rejected registration highlights the
 * offending field, not just a form-level banner.
 */
const serverFieldErrors = (error: unknown): FieldErrors => {
  if (!(error instanceof ApiError)) return NO_FIELD_ERRORS;
  const parsed = z
    .object({ fieldErrors: z.record(z.string(), z.array(z.string())) })
    .safeParse(error.appError.details);
  if (!parsed.success) return NO_FIELD_ERRORS;
  const pick = (key: Field): string | undefined => parsed.data.fieldErrors[key]?.[0];
  return { name: pick('name'), email: pick('email'), password: pick('password') };
};

export const RegisterPage = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signUp = useMutation({
    ...actions.signUp,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/app' });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setClientErrors({
        name: flat.name?.[0],
        email: flat.email?.[0],
        password: flat.password?.[0],
      });
      return;
    }
    setClientErrors(NO_FIELD_ERRORS);
    signUp.mutate(parsed.data);
  };

  const fieldErrors: FieldErrors = { ...serverFieldErrors(signUp.error), ...clientErrors };
  const formError = signUp.isError
    ? signUp.error instanceof ApiError
      ? signUp.error.appError.message
      : signUp.error.message
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
          agentproofarch
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          create your account
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth error={Boolean(fieldErrors.name)}>
            <FormLabel htmlFor="register-name">name</FormLabel>
            <OutlinedInput
              id="register-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
            {fieldErrors.name ? <FormHelperText>{fieldErrors.name}</FormHelperText> : null}
          </FormControl>
          <FormControl fullWidth error={Boolean(fieldErrors.email)}>
            <FormLabel htmlFor="register-email">email</FormLabel>
            <OutlinedInput
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
            {fieldErrors.email ? <FormHelperText>{fieldErrors.email}</FormHelperText> : null}
          </FormControl>
          <FormControl fullWidth error={Boolean(fieldErrors.password)}>
            <FormLabel htmlFor="register-password">password</FormLabel>
            <OutlinedInput
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            {fieldErrors.password ? <FormHelperText>{fieldErrors.password}</FormHelperText> : null}
          </FormControl>
          <Button type="submit" variant="contained" fullWidth disabled={signUp.isPending} sx={{ mt: '0.4rem' }}>
            {signUp.isPending ? 'creating…' : 'create account'}
          </Button>
        </Stack>
        {formError ? <Alert sx={{ mt: '0.6rem' }}>{formError}</Alert> : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <Eyebrow variant="caption" component="p">
          already have an account? <Link href="/login">sign in</Link>
        </Eyebrow>
      </Paper>
    </Box>
  );
};
