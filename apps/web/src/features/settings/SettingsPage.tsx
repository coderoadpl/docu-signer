import { Alert, Box, Chip, Container, Divider, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { CreateTenantForm } from './CreateTenantForm.js';
import { PasskeySection } from './PasskeySection.js';
import { TwoFactorSection } from './TwoFactorSection.js';
import { tenantUrl } from '../../lib/tenant.js';

/**
 * Settings home (US-017): the current tenant and the caller's staff role (read
 * from `/api/me`), links into the staff and domain sub-settings, and the
 * tenant-management surface (switch to another tenant, or create a new one).
 */
export const SettingsPage = () => {
  const me = useQuery(actions.me);
  const tenants = useQuery(actions.tenants);
  const tenant = me.data?.tenant ?? null;
  const isOwner = tenant?.staffRole === 'owner';
  const isStaff = tenant?.staffRole !== null && tenant?.staffRole !== undefined;

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '2.5rem' }}>
      <Typography variant="h1" sx={{ mb: '1.5rem' }}>
        Settings
      </Typography>

      <Paper variant="outlined" sx={{ p: '1.25rem', mb: '1.5rem' }}>
        <Typography variant="overline">current tenant</Typography>
        {tenant ? (
          <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '0.8rem', mt: '0.3rem' }}>
            <Typography variant="h2" component="p">
              {tenant.name}
            </Typography>
            <Typography variant="caption">{tenant.slug}</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small" variant="outlined" label={tenant.staffRole ?? 'member'} />
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ mt: '0.3rem' }}>
            no tenant selected on this host
          </Typography>
        )}
        {isStaff ? (
          <Stack direction="row" useFlexGap sx={{ columnGap: '1.2rem', mt: '1rem' }}>
            <Link component={RouterLink} to="/app/settings/staff" variant="body2">
              staff →
            </Link>
            <Link component={RouterLink} to="/app/settings/domains" variant="body2">
              domains →
            </Link>
          </Stack>
        ) : null}
        {isStaff && !isOwner ? (
          <Alert severity="info" sx={{ mt: '1rem' }}>
            You are an admin. Granting staff and changing domains are owner-only.
          </Alert>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: '1.25rem' }}>
        <Typography variant="overline">your tenants</Typography>
        <Stack useFlexGap spacing="0.4rem" sx={{ mt: '0.4rem' }}>
          {tenants.data?.tenants.map((m) => {
            const url = tenantUrl(m.tenant.slug);
            const active = m.tenant.slug === tenant?.slug;
            const label = `${m.tenant.name} (${m.staffRole})${active ? ' — current' : ''}`;
            return url === null || active ? (
              <Typography key={m.tenant.id} variant="body2" aria-current={active}>
                {label}
              </Typography>
            ) : (
              <Link key={m.tenant.id} href={url} variant="body2">
                {label} →
              </Link>
            );
          })}
        </Stack>
        <Divider sx={{ my: '1.2rem' }} />
        <Typography variant="overline" sx={{ display: 'block', mb: '0.6rem' }}>
          create a new tenant
        </Typography>
        <CreateTenantForm />
      </Paper>

      <TwoFactorSection />
      <PasskeySection />
    </Container>
  );
};
