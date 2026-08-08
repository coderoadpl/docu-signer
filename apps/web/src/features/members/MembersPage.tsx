import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  InputBase,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ensureMember,
  ensureMemberInvalidates,
  membersSelectors,
} from './index.web.js';

/**
 * Members view — a minimal STAFF-facing island: the tenant's end-customer roster
 * (read) plus the `ensureMember` entry point (write). It talks only to the island
 * seam (index.web.ts): reads through `membersSelectors`, writes through the bound
 * ensure mutation. The rich exemplars are the boards; this stays rung 1.
 */
export const MembersPage = () => {
  const queryClient = useQueryClient();
  const members = useQuery(membersSelectors.list);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const ensure = useMutation({
    ...ensureMember,
    onSuccess: () => {
      setEmail('');
      setName('');
    },
    onSettled: () => queryClient.invalidateQueries(ensureMemberInvalidates()),
  });

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '3rem' }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Members</Typography>
        <Typography variant="overline">end customers of this tenant</Typography>
      </Stack>

      {members.isPending ? (
        <Typography variant="h2" component="p" sx={{ py: 2 }}>
          reading the roster…
        </Typography>
      ) : null}
      {members.isError ? <Alert>{members.error.message}</Alert> : null}
      {members.data ? (
        members.data.members.length === 0 ? (
          <Typography variant="h2" component="p" sx={{ py: '24px' }}>
            — no members yet —
          </Typography>
        ) : (
          <List disablePadding>
            {members.data.members.map((member) => (
              <ListItem key={member.id} disableGutters sx={{ px: '0.2rem', gap: '0.6rem' }}>
                <ListItemText
                  primary={member.displayName ?? member.email}
                  secondary={member.email}
                  slotProps={{ secondary: { variant: 'caption' } }}
                />
                {member.tags.map((tag) => (
                  <Chip key={tag} size="small" variant="outlined" label={tag} />
                ))}
              </ListItem>
            ))}
          </List>
        )
      ) : null}

      <Paper
        component="form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (email.trim()) ensure.mutate({ email, ...(name.trim() ? { displayName: name } : {}) });
        }}
        sx={{ mt: '24px', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', p: '0.4rem' }}
      >
        <InputBase
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="customer email…"
          inputProps={{ 'aria-label': 'Member email', type: 'email' }}
          sx={{ flex: '2 1 12rem', '& input': { p: '11px 0.9rem' } }}
        />
        <InputBase
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="display name (optional)…"
          inputProps={{ 'aria-label': 'Member display name' }}
          sx={{ flex: '1 1 8rem', '& input': { p: '11px 0.9rem' } }}
        />
        <Button type="submit" variant="contained" disabled={ensure.isPending}>
          {ensure.isPending ? 'saving…' : 'ensure ↵'}
        </Button>
      </Paper>
      {ensure.isError ? <Alert sx={{ mt: '0.6rem' }}>{ensure.error.message}</Alert> : null}

      <Box sx={{ mt: '2rem' }}>
        <Button component="a" href="/app" variant="text">
          ← back to the ledger
        </Button>
      </Box>
    </Container>
  );
};
