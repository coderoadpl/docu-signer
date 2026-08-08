import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Divider, Link, Menu, MenuItem, Stack, ThemeProvider, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, Outlet, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from './api.js';
import { AppShell } from './components/layout/AppShell.js';
import { FocusCard } from './components/layout/FocusCard.js';
import { StatusView, type PageState } from './components/layout/StatusView.js';
import { CreateTenantForm } from './features/settings/CreateTenantForm.js';
import { tenantHue, tenantUrl } from './lib/tenant.js';
import { useThemeMode } from './theme-mode.js';
import { createThemeForMode, TenantName, Wordmark } from './theme.js';

const errorCodeOf = (error: unknown): string | null =>
  error instanceof ApiError ? error.appError.code : null;

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

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return <Shell state={{ kind: 'loading', label: 'Ładowanie aplikacji…' }} />;
  }
  if (unauthorized) return null;

  const noTenantHere =
    code === 'forbidden' || code === 'tenant_not_found' || (me.data && !me.data.tenant);
  if (noTenantHere) return <Onboarding />;

  if (me.isError || !me.data) {
    return (
      <Shell
        state={{ kind: 'error', message: me.error?.message ?? 'Something went wrong' }}
      />
    );
  }

  return <Shell tenant={me.data.tenant} email={me.data.email} />;
};

type Tenant = {
  id: string;
  slug: string;
  name: string;
  staffRole: string | null;
  memberId: string | null;
};

interface ShellProps {
  tenant?: Tenant | null;
  email?: string;
  state?: PageState;
}

const Shell = ({ tenant = null, email, state }: ShellProps) => {
  const { mode } = useThemeMode();
  const signOut = useSignOut();
  const slug = tenant?.slug ?? 'app';
  const theme = useMemo(() => createThemeForMode(mode, tenantHue(slug)), [mode, slug]);

  const navigation = (
    <>
      <Link component={RouterLink} to="/app" variant="body2">
        ledger
      </Link>
      <Link component={RouterLink} to="/app/board" variant="body2">
        board
      </Link>
      <Link component={RouterLink} to="/app/team-board" variant="body2">
        team board
      </Link>
      {tenant?.staffRole ? (
        <Link component={RouterLink} to="/app/members" variant="body2">
          members
        </Link>
      ) : null}
      {tenant?.staffRole ? (
        <Link component={RouterLink} to="/app/documents" variant="body2">
          Dokumenty
        </Link>
      ) : null}
      <Link component={RouterLink} to="/app/settings" variant="body2">
        settings
      </Link>
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
        context={tenant === null ? null : <TenantSwitcher activeSlug={tenant.slug} />}
        meta={
          <>
            {tenant?.staffRole ? (
              <Chip size="small" variant="outlined" label={tenant.staffRole} />
            ) : null}
            {email === undefined ? null : (
              <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' } }}>
                {email}
              </Typography>
            )}
          </>
        }
        actions={
          <Button
            variant="text"
            size="small"
            disabled={signOut.isPending}
            onClick={() => signOut.mutate()}
          >
            sign out
          </Button>
        }
        navigation={navigation}
        {...(state === undefined ? {} : { state })}
      >
        <Outlet />
      </AppShell>
    </ThemeProvider>
  );
};

const TenantSwitcher = ({ activeSlug }: { activeSlug: string | null }) => {
  const tenants = useQuery(actions.tenants);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = tenants.data?.tenants.find((membership) => membership.tenant.slug === activeSlug);

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="menu"
        aria-label="Switch tenant"
      >
        {active ? active.tenant.name : (activeSlug ?? 'select tenant')} ▾
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {tenants.data?.tenants.map((membership) => {
          const url = tenantUrl(membership.tenant.slug);
          return (
            <MenuItem
              key={membership.tenant.id}
              selected={membership.tenant.slug === activeSlug}
              disabled={url === null}
              {...(url === null ? {} : { component: 'a', href: url })}
              onClick={() => setAnchor(null)}
            >
              <TenantName>{membership.tenant.name}</TenantName>
              <Chip size="small" variant="outlined" label={membership.staffRole} sx={{ ml: '0.6rem' }} />
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem component={RouterLink} to="/app/settings" onClick={() => setAnchor(null)}>
          + create / manage tenants
        </MenuItem>
      </Menu>
    </>
  );
};

const Onboarding = () => {
  const tenants = useQuery(actions.tenants);
  const signOut = useSignOut();
  const tenantLinks =
    tenants.data && tenants.data.tenants.length > 0 ? (
      <Box sx={{ mb: '1.4rem' }}>
        <Typography variant="overline">your tenants</Typography>
        <Stack useFlexGap spacing="0.4rem" sx={{ mt: '0.4rem' }}>
          {tenants.data.tenants.map((membership) => {
            const url = tenantUrl(membership.tenant.slug);
            return url === null ? (
              <Typography key={membership.tenant.id} variant="body2">
                {membership.tenant.name} — open via the CLI (--tenant {membership.tenant.slug})
              </Typography>
            ) : (
              <Link key={membership.tenant.id} href={url} variant="body2">
                {membership.tenant.name} →
              </Link>
            );
          })}
        </Stack>
        <Divider sx={{ my: '1.2rem' }} />
      </Box>
    ) : undefined;

  return (
    <FocusCard
      header={<Wordmark variant="h1">Podpisy</Wordmark>}
      action={
        <Button
          variant="text"
          size="small"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          sign out
        </Button>
      }
    >
      <StatusView
        surface={false}
        state={{
          kind: 'empty',
          title: 'no tenant here yet — create one to get started',
          body: tenantLinks,
          action: <CreateTenantForm />,
        }}
      />
    </FocusCard>
  );
};
