import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormLabel,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { Invitation, StaffRole } from '#core/domain/index.js';

import { actions } from '../../api.js';

export const invitationManagementErrorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

const roleLabel = (role: StaffRole): string => role === 'owner' ? 'Właściciel' : 'Administrator';

export const InvitationsSection = () => {
  const queryClient = useQueryClient();
  const config = useQuery(actions.config);
  const invitations = useQuery(actions.invitations);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('admin');
  const [shownLink, setShownLink] = useState<string | null>(null);

  const copyLink = async (url: string) => {
    setShownLink(url);
    await navigator.clipboard?.writeText(url);
  };

  const create = useMutation({
    ...actions.createInvitation,
    onSuccess: async ({ url }) => {
      setEmail('');
      await copyLink(url);
      await queryClient.invalidateQueries(actions.invitationsInvalidates());
    },
  });
  const regenerate = useMutation({
    ...actions.createInvitation,
    onSuccess: async ({ url }) => {
      await copyLink(url);
      await queryClient.invalidateQueries(actions.invitationsInvalidates());
    },
  });
  const revoke = useMutation({
    ...actions.revokeInvitation,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.invitationsInvalidates());
    },
  });

  const pending = (invitations.data?.invitations ?? []).filter(
    (invitation): invitation is Invitation & { status: 'pending' } => invitation.status === 'pending',
  );

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Zaproszenia</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Dodaj zaufaną osobę do archiwum i wybierz jej rolę.
      </Typography>
      {config.data?.emailConfigured === false ? (
        <Alert severity="warning" sx={{ mb: '0.9rem' }}>
          Wysyłka e-mail nieskonfigurowana — przekaż link ręcznie.
        </Alert>
      ) : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.7rem">
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="invitation-email">Adres e-mail</FormLabel>
          <OutlinedInput
            id="invitation-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180, mt: { sm: '1.45rem' } }}>
          <InputLabel id="invitation-role-label">Rola</InputLabel>
          <Select
            labelId="invitation-role-label"
            label="Rola"
            value={role}
            onChange={(event) => setRole(event.target.value === 'owner' ? 'owner' : 'admin')}
          >
            <MenuItem value="admin">Administrator</MenuItem>
            <MenuItem value="owner">Właściciel</MenuItem>
          </Select>
        </FormControl>
        <Button
          variant="contained"
          disabled={create.isPending || email.trim().length === 0}
          onClick={() => create.mutate({ email, role })}
          sx={{ alignSelf: { sm: 'flex-end' } }}
        >
          {create.isPending ? 'Wysyłanie…' : 'Wyślij zaproszenie'}
        </Button>
      </Stack>
      {shownLink ? (
        <Alert severity="info" sx={{ mt: '0.9rem' }}>
          <Stack useFlexGap spacing="0.6rem">
            <Typography variant="body2">Link zaproszenia jest gotowy do ręcznego przekazania.</Typography>
            <OutlinedInput
              readOnly
              value={shownLink}
              inputProps={{ 'aria-label': 'Link zaproszenia' }}
            />
            <Button variant="outlined" onClick={() => void copyLink(shownLink)}>
              Skopiuj link
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {create.isError || regenerate.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>
          {invitationManagementErrorText(create.error ?? regenerate.error)}
        </Alert>
      ) : null}
      {invitations.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>{invitationManagementErrorText(invitations.error)}</Alert>
      ) : null}
      {pending.length > 0 ? (
        <List sx={{ mt: '0.7rem' }}>
          {pending.map((invitation) => (
            <ListItem
              key={invitation.id}
              disableGutters
              secondaryAction={
                <Stack direction="row" useFlexGap spacing="0.35rem" sx={{ alignItems: 'center' }}>
                  <Chip size="small" label="Oczekujące" color="warning" variant="outlined" />
                  <Button
                    size="small"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate({ email: invitation.email, role: invitation.role })}
                  >
                    Skopiuj link
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invitation.id)}
                  >
                    Unieważnij
                  </Button>
                </Stack>
              }
            >
              <ListItemText primary={invitation.email} secondary={roleLabel(invitation.role)} />
            </ListItem>
          ))}
        </List>
      ) : null}
    </Paper>
  );
};
