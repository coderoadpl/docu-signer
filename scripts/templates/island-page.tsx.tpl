import { Alert, Button, Container, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { send, __SINGULAR_CAMEL__Selectors } from './index.web.js';

/**
 * __SINGULAR_PASCAL__ view — talks ONLY to the island seam (the web composition
 * index.web.ts): it reads through `__SINGULAR_CAMEL__Selectors` and emits intents
 * through `send`. It never imports api.ts, the core factory, a descriptor or a
 * machine, so the core can graduate rungs without touching this file.
 */
export const __SINGULAR_PASCAL__Page = () => {
  const list = useQuery(__SINGULAR_CAMEL__Selectors.list);

  return (
    <Container sx={{ maxWidth: '44rem', py: '3rem' }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', mb: '1.5rem' }}>
        <Typography variant="h1">__SINGULAR_PASCAL__</Typography>
        <Button sx={{ ml: 'auto' }} onClick={() => send({ type: 'refreshRequested' })}>
          refresh
        </Button>
      </Stack>
      {list.isPending ? <Typography>loading…</Typography> : null}
      {list.isError ? <Alert>{list.error.message}</Alert> : null}
      {list.data ? (
        // Placeholder render: `list.data` is typed by the descriptor you bind in
        // core/selectors.ts. Replace with this island's real view.
        <Typography component="pre" sx={{ overflowX: 'auto' }}>
          {JSON.stringify(list.data, null, 2)}
        </Typography>
      ) : null}
    </Container>
  );
};
