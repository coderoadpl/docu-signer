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
