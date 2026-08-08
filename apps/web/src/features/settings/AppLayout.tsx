import { useEffect, useMemo, useState } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Link,
  Menu,
  MenuItem,
  Paper,
  Stack,
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, Outlet, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { CreateTenantForm } from './CreateTenantForm.js';
import { tenantHue, tenantUrl } from '../../lib/tenant.js';
import { useThemeMode } from '../../theme-mode.js';
import { createThemeForMode, Eyebrow, TenantName, Wordmark } from '../../theme.js';

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

/**
 * The authenticated shell (US-015): it guards every `/app/*` route (an anonymous
 * visitor is redirected to `/login`), owns the shared chrome — tenant switcher,
 * navigation and the logout action (US-016/US-017) — and renders the active child
 * through the `Outlet`. When the caller has no accessible tenant on this host
 * (the tenant-less apex, or a tenant domain they lack access to), it shows the
 * onboarding panel instead so a freshly-registered user lands here and creates
 * their first tenant.
 */
export const AppLayout = () => {
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const code = errorCodeOf(me.error);
  const unauthorized = code === 'unauthorized';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Typography variant="h2" component="p" sx={{ py: 6 }}>
          opening the app…
        </Typography>
      </Container>
    );
  }
  if (unauthorized) return null;

  // No accessible tenant on this host: the tenant-less apex (me ok, tenant null)
  // OR a tenant domain the caller cannot enter (forbidden / tenant_not_found).
  const noTenantHere = code === 'forbidden' || code === 'tenant_not_found' || (me.data && !me.data.tenant);
  if (noTenantHere) return <Onboarding />;

  if (me.isError || !me.data) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Typography variant="h2" component="p" sx={{ py: 6 }}>
          {me.error?.message ?? 'Something went wrong'}
        </Typography>
      </Container>
    );
  }

  return <Shell tenant={me.data.tenant} email={me.data.email} />;
};

type Tenant = { id: string; slug: string; name: string; staffRole: string | null; memberId: string | null };

const Shell = ({ tenant, email }: { tenant: Tenant | null; email: string }) => {
  const { mode } = useThemeMode();
  const signOut = useSignOut();
  const slug = tenant?.slug ?? 'app';
  const theme = useMemo(() => createThemeForMode(mode, tenantHue(slug)), [mode, slug]);

  return (
    <ThemeProvider theme={theme}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ gap: '1rem', flexWrap: 'wrap' }}>
          <RouterLink to="/app" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Wordmark variant="h2">agentproofarch</Wordmark>
          </RouterLink>
          <TenantSwitcher activeSlug={tenant?.slug ?? null} />
          <Box sx={{ flex: 1 }} />
          {tenant?.staffRole ? <Chip size="small" variant="outlined" label={tenant.staffRole} /> : null}
          <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {email}
          </Typography>
          <Button variant="text" size="small" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            sign out
          </Button>
        </Toolbar>
        <Stack
          component="nav"
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', columnGap: '1.2rem', rowGap: '0.3rem', px: '1.5rem', pb: '0.6rem' }}
        >
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
          <Link component={RouterLink} to="/app/settings" variant="body2">
            settings
          </Link>
        </Stack>
      </AppBar>
      <Divider />
      <Outlet />
    </ThemeProvider>
  );
};

/** Header switcher (US-017): lists my tenants; selecting one navigates to its host. */
const TenantSwitcher = ({ activeSlug }: { activeSlug: string | null }) => {
  const tenants = useQuery(actions.tenants);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const active = tenants.data?.tenants.find((m) => m.tenant.slug === activeSlug);

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
        {tenants.data?.tenants.map((m) => {
          const url = tenantUrl(m.tenant.slug);
          return (
            <MenuItem
              key={m.tenant.id}
              selected={m.tenant.slug === activeSlug}
              disabled={url === null}
              {...(url === null ? {} : { component: 'a', href: url })}
              onClick={() => setAnchor(null)}
            >
              <TenantName>{m.tenant.name}</TenantName>
              <Chip size="small" variant="outlined" label={m.staffRole} sx={{ ml: '0.6rem' }} />
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

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: '26rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}>
        <Stack direction="row" sx={{ alignItems: 'baseline' }}>
          <Wordmark variant="h1">agentproofarch</Wordmark>
          <Box sx={{ flex: 1 }} />
          <Button variant="text" size="small" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            sign out
          </Button>
        </Stack>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>
          no tenant here yet — create one to get started
        </Eyebrow>

        {tenants.data && tenants.data.tenants.length > 0 ? (
          <Box sx={{ mb: '1.4rem' }}>
            <Typography variant="overline">your tenants</Typography>
            <Stack useFlexGap spacing="0.4rem" sx={{ mt: '0.4rem' }}>
              {tenants.data.tenants.map((m) => {
                const url = tenantUrl(m.tenant.slug);
                return url === null ? (
                  <Typography key={m.tenant.id} variant="body2">
                    {m.tenant.name} — open via the CLI (--tenant {m.tenant.slug})
                  </Typography>
                ) : (
                  <Link key={m.tenant.id} href={url} variant="body2">
                    {m.tenant.name} →
                  </Link>
                );
              })}
            </Stack>
            <Divider sx={{ my: '1.2rem' }} />
          </Box>
        ) : null}

        <CreateTenantForm />
      </Paper>
    </Box>
  );
};
