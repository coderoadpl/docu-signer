import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';

type DomainTarget = { cname: string | null; ip: string | null };

const dnsInstruction = (target: DomainTarget): string =>
  target.cname
    ? `Utwórz rekord CNAME wskazujący domenę na ${target.cname}.`
    : target.ip
      ? `Utwórz rekord A wskazujący domenę na ${target.ip}.`
      : 'Skieruj domenę na tę instalację, a następnie sprawdź konfigurację.';

/**
 * Domains settings (US-019): the tenant's custom domains with verified status,
 * an add form that shows the required DNS record, a per-domain re-check, and a
 * confirmed remove. Adding, checking and removing are owner-only server-side —
 * a non-owner sees the roster but its errors surface humanely.
 */
export const DomainsPage = () => {
  const queryClient = useQueryClient();
  const domains = useQuery(actions.domains);
  const [domain, setDomain] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries(actions.domainsInvalidates());

  const add = useMutation({
    ...actions.addDomain,
    onSuccess: () => setDomain(''),
    onSettled: invalidate,
  });
  const check = useMutation({ ...actions.checkDomain, onSettled: invalidate });
  const remove = useMutation({ ...actions.removeDomain, onSettled: invalidate });

  const target: DomainTarget = domains.data?.target ?? { cname: null, ip: null };

  const confirmRemove = () => {
    if (!pendingRemove) return;
    remove.mutate({ domain: pendingRemove });
    setPendingRemove(null);
  };

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '2.5rem' }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Domeny</Typography>
        <Typography variant="overline">Domeny niestandardowe tej firmy</Typography>
      </Stack>

      {domains.isPending ? (
        <Typography variant="h2" component="p" sx={{ py: 2 }}>
          Ładowanie domen…
        </Typography>
      ) : null}
      {domains.isError ? <Alert severity="error">{domains.error.message}</Alert> : null}
      {domains.data ? (
        domains.data.domains.length === 0 ? (
          <Typography variant="h2" component="p" sx={{ py: '24px' }}>
            — brak domen niestandardowych —
          </Typography>
        ) : (
          <List disablePadding>
            {domains.data.domains.map((row) => (
              <ListItem key={row.id} disableGutters sx={{ px: '0.2rem', gap: '0.6rem' }}>
                <ListItemText primary={row.domain} />
                <Chip
                  size="small"
                  variant="outlined"
                  color={row.verified ? 'success' : 'default'}
                  label={row.verified ? 'zweryfikowana' : 'oczekuje'}
                />
                <Button
                  variant="text"
                  size="small"
                  disabled={check.isPending}
                  onClick={() => check.mutate({ domain: row.domain })}
                >
                  Sprawdź
                </Button>
                <Button
                  variant="text"
                  size="small"
                  color="error"
                  disabled={remove.isPending}
                  onClick={() => setPendingRemove(row.domain)}
                >
                  Usuń
                </Button>
              </ListItem>
            ))}
          </List>
        )
      ) : null}

      <Paper variant="outlined" sx={{ mt: '1.5rem', p: '1rem' }}>
        <Typography variant="overline" sx={{ display: 'block', mb: '0.4rem' }}>
          Dodaj domenę niestandardową
        </Typography>
        <Alert severity="info" sx={{ mb: '0.8rem' }}>
          {dnsInstruction(target)}
        </Alert>
        <Box
          component="form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (domain.trim()) add.mutate({ domain });
          }}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          <OutlinedInput
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="shop.example.com"
            size="small"
            inputProps={{ 'aria-label': 'Nowa domena' }}
            sx={{ flex: '2 1 12rem' }}
          />
          <Button type="submit" variant="contained" disabled={add.isPending}>
            {add.isPending ? 'Dodawanie…' : 'Dodaj domenę'}
          </Button>
        </Box>
      </Paper>
      {add.isError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{add.error.message}</Alert> : null}
      {check.isError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{check.error.message}</Alert> : null}
      {remove.isError ? <Alert severity="error" sx={{ mt: '0.6rem' }}>{remove.error.message}</Alert> : null}

      <Dialog open={pendingRemove !== null} onClose={() => setPendingRemove(null)}>
        <DialogTitle>Usunąć tę domenę?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pendingRemove
              ? `Odłączyć ${pendingRemove} od tej firmy? Aplikacja przestanie być dostępna pod tym adresem.`
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingRemove(null)}>Anuluj</Button>
          <Button color="error" variant="contained" onClick={confirmRemove}>
            Usuń
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ mt: '2rem' }}>
        <Button variant="text" onClick={() => window.history.back()}>
          ← Wróć do ustawień
        </Button>
      </Box>
    </Container>
  );
};
