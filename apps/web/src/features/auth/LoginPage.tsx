import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { DemoValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/' });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    signIn.mutate({ email, password });
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{
          width: '100%',
          maxWidth: '23rem',
          px: '1.8rem',
          pt: '2rem',
          pb: '1.6rem',
          animation: 'settle 0.45s ease-out both',
        }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
          agentproofarch
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          sign in · tenant {window.location.hostname}
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="login-email">email</FormLabel>
            <OutlinedInput
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </FormControl>
          <FormControl fullWidth>
            <FormLabel htmlFor="login-password">password</FormLabel>
            <OutlinedInput
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={signIn.isPending}
            sx={{ mt: '0.4rem' }}
          >
            {signIn.isPending ? 'signing in…' : 'sign in'}
          </Button>
        </Stack>
        {signIn.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {signIn.error instanceof ApiError ? signIn.error.appError.message : signIn.error.message}
          </Alert>
        ) : null}
        <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
        <FinePrint variant="caption" component="p" sx={{ mb: '1em' }}>
          demo account: <DemoValue>demo@agentproofarch.dev</DemoValue> /{' '}
          <DemoValue>demo1234</DemoValue>
        </FinePrint>
      </Paper>
    </Box>
  );
};
