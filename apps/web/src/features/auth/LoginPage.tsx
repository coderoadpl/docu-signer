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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { DemoValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const config = useQuery(actions.config);

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/app' });
    },
  });

  const magicLink = useMutation(actions.requestMagicLink);

  const passkey = useMutation({
    ...actions.signInPasskey,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/app' });
    },
  });

  const google = useMutation({
    ...actions.signInSocial,
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
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
          <Button
            type="button"
            variant="outlined"
            fullWidth
            disabled={magicLink.isPending || email.length === 0}
            onClick={() => magicLink.mutate({ email, callbackURL: `${window.location.origin}/app` })}
          >
            {magicLink.isPending ? 'sending link…' : 'email me a sign-in link'}
          </Button>
          <Button
            type="button"
            variant="outlined"
            fullWidth
            disabled={passkey.isPending}
            onClick={() => passkey.mutate()}
          >
            {passkey.isPending ? 'waiting for passkey…' : 'continue with a passkey'}
          </Button>
          {config.data?.googleEnabled ? (
            <Button
              type="button"
              variant="outlined"
              fullWidth
              disabled={google.isPending}
              onClick={() => google.mutate({ provider: 'google', callbackURL: `${window.location.origin}/app` })}
            >
              continue with Google
            </Button>
          ) : null}
        </Stack>
        {magicLink.isSuccess ? (
          <Alert severity="success" sx={{ mt: '0.6rem' }}>
            Check your email for a sign-in link. In dev the send is captured by Mailpit — open its inbox to follow the link.
          </Alert>
        ) : null}
        {signIn.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {signIn.error instanceof ApiError ? signIn.error.appError.message : signIn.error.message}
          </Alert>
        ) : null}
        {passkey.isError ? (
          <Alert sx={{ mt: '0.6rem' }}>
            {passkey.error instanceof ApiError ? passkey.error.appError.message : passkey.error.message}
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
