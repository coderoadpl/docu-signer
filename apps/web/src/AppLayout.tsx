import { useEffect } from 'react';
import { Button, ListItemButton, ListItemText, ThemeProvider, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, Outlet, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from './api.js';
import { AppShell } from './components/layout/AppShell.js';
import type { PageState } from './components/layout/StatusView.js';
import { useAppTheme, Wordmark } from './theme.js';

const errorCodeOf = (error: Error | null): string | null =>
  error instanceof ApiError ? error.appError.code : null;

const noArchiveAccessState: PageState = {
  kind: 'empty',
  title: 'Brak dostępu do archiwum',
  body: 'To konto nie jest przypisane do archiwum dokumentów.',
};

const useSignOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });
};

export const AppLayout = () => {
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const code = errorCodeOf(me.error);
  const unauthorized = code === 'unauthorized';
  const forbidden = code === 'forbidden';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return <Shell state={{ kind: 'loading', label: 'Ładowanie aplikacji…' }} />;
  }
  if (unauthorized) return null;
  if (forbidden) {
    return <Shell state={noArchiveAccessState} />;
  }
  if (me.isError || !me.data) {
    return (
      <Shell
        state={{ kind: 'error', message: me.error?.message ?? 'Wystąpił nieoczekiwany błąd' }}
      />
    );
  }
  if (!me.data.tenant) {
    return <Shell email={me.data.email} state={noArchiveAccessState} />;
  }

  return <Shell tenant={me.data.tenant} email={me.data.email} />;
};

interface ShellProps {
  tenant?: { slug: string; name: string } | null;
  email?: string;
  state?: PageState;
}

const Shell = ({ tenant = null, email, state }: ShellProps) => {
  const signOut = useSignOut();
  const theme = useAppTheme();

  const navigation = (
    <>
      <ListItemButton className="app-shell-nav-item" component={RouterLink} to="/app/documents">
        <ListItemText primary="Dokumenty" />
      </ListItemButton>
      <ListItemButton className="app-shell-nav-item" component={RouterLink} to="/app/settings">
        <ListItemText primary="Konto" />
      </ListItemButton>
    </>
  );

  return (
    <ThemeProvider theme={theme}>
      <AppShell
        brand={
          <RouterLink to="/app" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Wordmark variant="h2">Podpisy</Wordmark>
          </RouterLink>
        }
        context={
          tenant ? (
            <Typography variant="h6" component="p" noWrap>
              {tenant.name}
            </Typography>
          ) : null
        }
        meta={
          email ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              {email}
            </Typography>
          ) : null
        }
        actions={
          <Button
            variant="text"
            size="small"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            Wyloguj się
          </Button>
        }
        navigation={tenant ? navigation : null}
        {...(state === undefined ? {} : { state })}
      >
        <Outlet />
      </AppShell>
    </ThemeProvider>
  );
};
