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
  InputBase,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';

interface StaffRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin';
}

/**
 * Staff settings (US-018, errata: NO invitations). The roster is staff-readable
 * (owner+admin); granting admin by email and revoking are OWNER-ONLY. Revoke is
 * gated behind a confirmation dialog — the mutation fires only on explicit
 * confirm — and the last-owner lockout / not-found errors surface humanely.
 */
export const StaffSettingsPage = () => {
  const queryClient = useQueryClient();
  const me = useQuery(actions.me);
  const staff = useQuery(actions.staff);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<StaffRow | null>(null);

  const isOwner = me.data?.tenant?.staffRole === 'owner';
  const invalidate = () => queryClient.invalidateQueries(actions.staffInvalidates());

  const grant = useMutation({
    ...actions.grantStaff,
    onSuccess: () => setEmail(''),
    onSettled: invalidate,
  });
  const revoke = useMutation({
    ...actions.revokeStaff,
    onSettled: invalidate,
  });

  const confirmRevoke = () => {
    if (!pending) return;
    revoke.mutate({ userId: pending.userId });
    setPending(null);
  };

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '2.5rem' }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Staff</Typography>
        <Typography variant="overline">owner &amp; admin access (FR-8)</Typography>
      </Stack>

      {staff.isPending ? (
        <Typography variant="h2" component="p" sx={{ py: 2 }}>
          reading the roster…
        </Typography>
      ) : null}
      {staff.isError ? <Alert>{staff.error.message}</Alert> : null}
      {staff.data ? (
        <List disablePadding>
          {staff.data.staff.map((member) => (
            <ListItem key={member.id} disableGutters sx={{ px: '0.2rem', gap: '0.6rem' }}>
              <ListItemText
                primary={member.name || member.email}
                secondary={member.email}
                slotProps={{ secondary: { variant: 'caption' } }}
              />
              <Chip size="small" variant="outlined" label={member.role} />
              {isOwner ? (
                <Button
                  variant="text"
                  size="small"
                  color="error"
                  disabled={member.role === 'owner' || revoke.isPending}
                  onClick={() => setPending(member)}
                >
                  revoke
                </Button>
              ) : null}
            </ListItem>
          ))}
        </List>
      ) : null}

      {isOwner ? (
        <Paper
          component="form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (email.trim()) grant.mutate({ email });
          }}
          sx={{ mt: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', p: '0.4rem' }}
        >
          <InputBase
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="grant admin to a registered email…"
            inputProps={{ 'aria-label': 'Grant admin email', type: 'email' }}
            sx={{ flex: '2 1 12rem', '& input': { p: '11px 0.9rem' } }}
          />
          <Button type="submit" variant="contained" disabled={grant.isPending}>
            {grant.isPending ? 'granting…' : 'grant ↵'}
          </Button>
        </Paper>
      ) : (
        <Alert severity="info" sx={{ mt: '1.5rem' }}>
          Only an owner can grant or revoke staff access.
        </Alert>
      )}
      {grant.isError ? <Alert sx={{ mt: '0.6rem' }}>{grant.error.message}</Alert> : null}
      {revoke.isError ? <Alert sx={{ mt: '0.6rem' }}>{revoke.error.message}</Alert> : null}

      <Dialog open={pending !== null} onClose={() => setPending(null)}>
        <DialogTitle>Revoke staff access?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pending
              ? `Remove ${pending.name || pending.email}'s admin access to this tenant? They keep their account but lose staff access here.`
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmRevoke}>
            Revoke
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ mt: '2rem' }}>
        <Button variant="text" onClick={() => window.history.back()}>
          ← back to settings
        </Button>
      </Box>
    </Container>
  );
};
