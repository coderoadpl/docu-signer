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
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { DemoValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const loginSearchSchema = z.object({
  redirect: z.string().optional(),
});

const APP_HOME = '/app';

const isSameOriginPath = (target: string): boolean =>
  target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\');

const loginRedirectTarget = (redirect: string | undefined): string =>
  redirect !== undefined && isSameOriginPath(redirect) ? redirect : APP_HOME;

const authErrorMessage = (error: Error): string => {
  const message = error instanceof ApiError ? error.appError.message : error.message;
  return message === 'Invalid email or password'
    ? 'Nieprawidłowy adres e-mail lub hasło'
    : message;
};

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [code, setCode] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const parsedSearch = loginSearchSchema.safeParse(search);
  const redirectTarget = loginRedirectTarget(
    parsedSearch.success ? parsedSearch.data.redirect : undefined,
  );
  const callbackURL = `${window.location.origin}${redirectTarget}`;
  const magicLinkEnabled =
    import.meta.env.DEV || import.meta.env.VITE_MAGIC_LINK === 'on';

  const config = useQuery(actions.config);

  const goToRedirectTarget = async () => {
    await queryClient.resetQueries();
    await navigate({ href: redirectTarget });
  };

  const signIn = useMutation({
    ...actions.signIn,
    onSuccess: async (result) => {
      if (result.twoFactorRequired === true) {
        setTwoFactorRequired(true);
        return;
      }
      await goToRedirectTarget();
    },
  });

  const verifyTotp = useMutation({
    ...actions.verifyTotp,
    onSuccess: goToRedirectTarget,
  });

  const magicLink = useMutation(actions.requestMagicLink);

  const passkey = useMutation({
    ...actions.signInPasskey,
    onSuccess: goToRedirectTarget,
  });

  const google = useMutation({
    ...actions.signInSocial,
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (twoFactorRequired) {
      verifyTotp.mutate({ code });
    } else {
      signIn.mutate({ email, password });
    }
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
          Podpisy
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.6rem' }}>
          Logowanie · {window.location.hostname}
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          {twoFactorRequired ? (
            <>
              <Alert severity="info">
                Hasło jest poprawne. Wpisz kod z aplikacji uwierzytelniającej.
              </Alert>
              <FormControl fullWidth>
                <FormLabel htmlFor="login-totp">Kod jednorazowy</FormLabel>
                <OutlinedInput
                  id="login-totp"
                  name="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputProps={{ inputMode: 'numeric', maxLength: 6, pattern: '[0-9]*' }}
                  required
                />
              </FormControl>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={verifyTotp.isPending}
                sx={{ mt: '0.4rem' }}
              >
                {verifyTotp.isPending ? 'Sprawdzanie…' : 'Potwierdź kod'}
              </Button>
              <Button
                type="button"
                variant="text"
                fullWidth
                onClick={() => {
                  setTwoFactorRequired(false);
                  setCode('');
                  verifyTotp.reset();
                }}
              >
                Wróć do logowania
              </Button>
            </>
          ) : (
            <>
              <FormControl fullWidth>
                <FormLabel htmlFor="login-email">Adres e-mail</FormLabel>
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
                <FormLabel htmlFor="login-password">Hasło</FormLabel>
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
                {signIn.isPending ? 'Logowanie…' : 'Zaloguj się'}
              </Button>
              {magicLinkEnabled ? (
                <Button
                  type="button"
                  variant="outlined"
                  fullWidth
                  disabled={magicLink.isPending || email.length === 0}
                  onClick={() => magicLink.mutate({ email, callbackURL })}
                >
                  {magicLink.isPending
                    ? 'Wysyłanie linku…'
                    : 'Wyślij link do logowania'}
                </Button>
              ) : null}
              {config.data?.passwordResetEnabled ? (
                <Button type="button" variant="text" fullWidth href="/forgot-password">
                  Nie pamiętasz hasła?
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outlined"
                fullWidth
                disabled={passkey.isPending}
                onClick={() => passkey.mutate()}
              >
                {passkey.isPending
                  ? 'Oczekiwanie na klucz…'
                  : 'Zaloguj się kluczem dostępu'}
              </Button>
              {config.data?.googleEnabled ? (
                <Button
                  type="button"
                  variant="outlined"
                  fullWidth
                  disabled={google.isPending}
                  onClick={() => google.mutate({ provider: 'google', callbackURL })}
                >
                  Zaloguj się przez Google
                </Button>
              ) : null}
            </>
          )}
        </Stack>
        {magicLinkEnabled && magicLink.isSuccess ? (
          <Alert severity="success" sx={{ mt: '0.6rem' }}>
            Sprawdź skrzynkę e-mail. W środowisku deweloperskim wiadomość
            znajdziesz w Mailpit.
          </Alert>
        ) : null}
        {magicLink.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {authErrorMessage(magicLink.error)}
          </Alert>
        ) : null}
        {signIn.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {authErrorMessage(signIn.error)}
          </Alert>
        ) : null}
        {verifyTotp.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {authErrorMessage(verifyTotp.error)}
          </Alert>
        ) : null}
        {passkey.isError ? (
          <Alert severity="error" sx={{ mt: '0.6rem' }}>
            {authErrorMessage(passkey.error)}
          </Alert>
        ) : null}
        {import.meta.env.DEV ? (
          <>
            <Divider sx={{ mt: '1.4rem', mb: '0.9rem' }} />
            <FinePrint variant="caption" component="p" sx={{ mb: '1em' }}>
              konto demonstracyjne: <DemoValue>demo@agentproofarch.dev</DemoValue> /{' '}
              <DemoValue>demo1234</DemoValue>
            </FinePrint>
          </>
        ) : null}
      </Paper>
    </Box>
  );
};
