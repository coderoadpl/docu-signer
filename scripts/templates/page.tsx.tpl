import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Container,
  InputBase,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';

/**
 * __PLURAL_PASCAL__ page — a plain-CRUD view that reads server state DIRECTLY
 * through `actions` (the rung-0 starting point, like the pre-existing todos page).
 *
 * RUNG-1 CORE (ADR-0005 — the events-in / selectors-out seam is uniform, no
 * opt-outs): when this feature gains its own client state, give it the seam with
 * `pnpm run new:island -- __SINGULAR_KEBAB__`, point that island's
 * `__SINGULAR_CAMEL__Selectors.list` at this resource's `actions.__PLURAL_CAMEL__`,
 * and read through the core here instead of importing api.ts — the generated
 * island page shows the shape. See docs/decisions/0005-client-application-state.md.
 */
export const __PLURAL_PASCAL__Page = () => {
  const queryClient = useQueryClient();
  const __PLURAL_CAMEL__ = useQuery(actions.__PLURAL_CAMEL__);
  const [title, setTitle] = useState('');

  const add__SINGULAR_PASCAL__ = useMutation({
    ...actions.add__SINGULAR_PASCAL__,
    onSuccess: () => setTitle(''),
    onSettled: () => queryClient.invalidateQueries(actions.add__SINGULAR_PASCAL__Invalidates()),
  });

  return (
    <Container sx={{ maxWidth: '44rem', py: '3rem' }}>
      <Typography variant="h1" sx={{ mb: '1.5rem' }}>
        __PLURAL_PASCAL__
      </Typography>
      {__PLURAL_CAMEL__.isPending ? <Typography>loading…</Typography> : null}
      {__PLURAL_CAMEL__.isError ? <Alert>{__PLURAL_CAMEL__.error.message}</Alert> : null}
      {__PLURAL_CAMEL__.data ? (
        <List disablePadding>
          {__PLURAL_CAMEL__.data.__PLURAL_CAMEL__.map((row) => (
            <ListItem key={row.id} disableGutters>
              <ListItemText primary={row.title} />
            </ListItem>
          ))}
        </List>
      ) : null}
      <Paper
        component="form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (title.trim()) add__SINGULAR_PASCAL__.mutate({ title });
        }}
        sx={{ mt: '1.5rem', display: 'flex' }}
      >
        <InputBase
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="new __SINGULAR_KEBAB__…"
          inputProps={{ 'aria-label': 'New __SINGULAR_KEBAB__ title' }}
          sx={{ flex: 1, '& input': { p: '11px 0.9rem' } }}
        />
        <Button type="submit" variant="contained" disabled={add__SINGULAR_PASCAL__.isPending}>
          add
        </Button>
      </Paper>
    </Container>
  );
};
