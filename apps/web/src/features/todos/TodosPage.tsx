import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  InputBase,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { tenantHue, tenantUrl } from '../../lib/tenant.js';
import { useThemeMode } from '../../theme-mode.js';
import {
  CardTitle,
  createThemeForMode,
  EntryDate,
  EntryIndex,
  Eyebrow,
  HeaderMeta,
  HeaderMetaBreak,
  LedgerHeader,
  LedgerNav,
  TenantSwatch,
} from '../../theme.js';

export const TodosPage = () => {
  const navigate = useNavigate();
  const me = useQuery(actions.me);

  const unauthorized =
    me.error instanceof ApiError && me.error.appError.code === 'unauthorized';

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [unauthorized, navigate]);

  if (me.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Typography variant="h2" component="p" sx={{ py: 6 }}>
          opening the logbook…
        </Typography>
      </Container>
    );
  }
  if (unauthorized) return null;
  if (me.isError) {
    return (
      <Container sx={{ maxWidth: '44rem' }}>
        <Alert sx={{ mt: 4 }}>{me.error.message}</Alert>
      </Container>
    );
  }

  return me.data.tenant ? (
    <TenantLedger tenant={me.data.tenant} email={me.data.email} />
  ) : (
    <PickTenant />
  );
};

const PickTenant = () => {
  const tenants = useQuery(actions.tenants);
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
      >
        <CardTitle variant="h1">Choose a tenant</CardTitle>
        <Eyebrow variant="overline" component="p">
          every tenant lives on its own domain
        </Eyebrow>
        {tenants.isPending ? (
          <Typography variant="h2" component="p" sx={{ py: 2 }}>
            loading…
          </Typography>
        ) : null}
        <List sx={{ mt: '1.2rem' }} disablePadding>
          {tenants.data?.tenants.map((m) => (
            <ListItem key={m.tenant.id} disablePadding>
              <ListItemButton component="a" href={tenantUrl(m.tenant.slug)} sx={{ px: '0.3rem' }}>
                <ListItemText
                  primary={m.tenant.name}
                  secondary={tenantUrl(m.tenant.slug)}
                  slotProps={{ primary: { sx: { fontWeight: 700 } }, secondary: { variant: 'caption' } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  );
};

const TenantLedger = ({
  tenant,
  email,
}: {
  tenant: { id: string; slug: string; name: string; staffRole: string | null; memberId: string | null };
  email: string;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const todos = useQuery(actions.todos);
  const tenants = useQuery(actions.tenants);
  const [title, setTitle] = useState('');
  const { mode } = useThemeMode();
  const theme = useMemo(
    () => createThemeForMode(mode, tenantHue(tenant.slug)),
    [mode, tenant.slug],
  );

  const addTodo = useMutation({
    ...actions.addTodo,
    onSuccess: () => setTitle(''),
    onSettled: () => queryClient.invalidateQueries(actions.addTodoInvalidates()),
  });

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', pb: '6rem' }}>
        <LedgerHeader
          component="header"
          sx={{
            pt: '48px',
            pb: '21px',
            animation: 'settle 0.5s ease-out both',
          }}
        >
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '1rem', rowGap: '0.6rem' }}
          >
            <TenantSwatch
              aria-hidden
              sx={{
                width: '0.85rem',
                height: '0.85rem',
                transform: 'translateY(1px)',
              }}
            />
            <Typography variant="h1">{tenant.name}</Typography>
            <HeaderMeta variant="overline">{window.location.hostname}</HeaderMeta>
            <Box sx={{ flex: 1 }} />
            <Chip variant="outlined" label={tenant.staffRole ?? 'member'} />
          </Stack>
          <Stack
            direction="row"
            useFlexGap
            sx={{ alignItems: 'baseline', columnGap: '1rem' }}
          >
            <HeaderMetaBreak variant="overline">{email}</HeaderMetaBreak>
            <Box sx={{ flex: 1 }} />
            <Button variant="text" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
              sign out
            </Button>
          </Stack>
        </LedgerHeader>

        <LedgerNav
          component="nav"
          direction="row"
          useFlexGap
          sx={{
            flexWrap: 'wrap',
            columnGap: '1.4rem',
            rowGap: '0.4rem',
            pt: '12px',
            // content is 27px (baseline-aligned mixed font sizes), +8+1 = 48
            pb: '8px',
            animation: 'settle 0.5s 0.08s ease-out both',
          }}
        >
          <Typography variant="overline">your tenants →</Typography>
          {tenants.data?.tenants.map((m) => {
            const active = m.tenant.id === tenant.id;
            return (
              <Link
                key={m.tenant.id}
                href={tenantUrl(m.tenant.slug)}
                variant="body2"
                aria-current={active}
              >
                {m.tenant.slug}
              </Link>
            );
          })}
        </LedgerNav>

        <Box component="section" sx={{ mt: '48px', animation: 'settle 0.5s 0.16s ease-out both' }}>
          <Typography variant="h2" component="h2" sx={{ mb: '24px' }}>
            Entries in this tenant's ledger
          </Typography>
          {todos.isPending ? (
            <Typography variant="h2" component="p" sx={{ py: 2 }}>
              reading entries…
            </Typography>
          ) : null}
          {todos.isError ? <Alert>{todos.error.message}</Alert> : null}
          {todos.data ? (
            todos.data.todos.length === 0 ? (
              <Typography variant="h2" component="p" sx={{ py: '24px' }}>
                — no entries yet; this tenant's page is blank —
              </Typography>
            ) : (
              <List disablePadding>
                {todos.data.todos.map((todo, index) => (
                  <ListItem key={todo.id} disableGutters sx={{ px: '0.2rem' }}>
                    <EntryIndex variant="caption" sx={{ minWidth: '1.7rem' }}>
                      {String(index + 1).padStart(2, '0')}
                    </EntryIndex>
                    <ListItemText primary={todo.title} sx={{ m: 0 }} />
                    <EntryDate
                      variant="caption"
                      component="time"
                      dateTime={todo.createdAt}
                      sx={{ ml: 'auto' }}
                    >
                      {new Date(todo.createdAt).toLocaleDateString()}
                    </EntryDate>
                  </ListItem>
                ))}
              </List>
            )
          ) : null}

          <Paper
            component="form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (title.trim()) addTodo.mutate({ title });
            }}
            sx={{ mt: '24px', display: 'flex' }}
          >
            <InputBase
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`new entry for ${tenant.name}…`}
              inputProps={{ 'aria-label': 'New todo title' }}
              sx={{ flex: 1, '& input': { p: '11px 0.9rem' } }}
            />
            <Button type="submit" variant="contained" disabled={addTodo.isPending}>
              {addTodo.isPending ? 'adding…' : 'add ↵'}
            </Button>
          </Paper>
          {addTodo.isError ? <Alert sx={{ mt: '0.6rem' }}>{addTodo.error.message}</Alert> : null}
        </Box>
      </Container>
    </ThemeProvider>
  );
};
