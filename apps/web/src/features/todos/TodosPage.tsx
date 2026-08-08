import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
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

import { actions } from '../../api.js';
import { EntryDate, EntryIndex } from '../../theme.js';

/**
 * The tenant ledger (US-015): the todos of the active tenant plus the add-entry
 * form. The authenticated shell (`AppLayout`) owns auth, the tenant switcher and
 * logout, and only renders this route once a tenant is resolved — so the page is
 * pure ledger content and reads the tenant name off the cached `/api/me`.
 */
export const TodosPage = () => {
  const queryClient = useQueryClient();
  const me = useQuery(actions.me);
  const todos = useQuery(actions.todos);
  const [title, setTitle] = useState('');

  const addTodo = useMutation({
    ...actions.addTodo,
    onSuccess: () => setTitle(''),
    onSettled: () => queryClient.invalidateQueries(actions.addTodoInvalidates()),
  });

  const tenantName = me.data?.tenant?.name ?? 'this tenant';

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', py: '2.5rem' }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem', mb: '1.5rem' }}>
        <Typography variant="h1">Ledger</Typography>
        <Typography variant="overline">{tenantName}</Typography>
      </Stack>

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
                <EntryDate variant="caption" component="time" dateTime={todo.createdAt} sx={{ ml: 'auto' }}>
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
          placeholder={`new entry for ${tenantName}…`}
          inputProps={{ 'aria-label': 'New todo title' }}
          sx={{ flex: 1, '& input': { p: '11px 0.9rem' } }}
        />
        <Button type="submit" variant="contained" disabled={addTodo.isPending}>
          {addTodo.isPending ? 'adding…' : 'add ↵'}
        </Button>
      </Paper>
      {addTodo.isError ? <Alert sx={{ mt: '0.6rem' }}>{addTodo.error.message}</Alert> : null}
      <Box sx={{ height: '1rem' }} />
    </Container>
  );
};
