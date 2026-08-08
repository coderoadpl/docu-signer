import type { ReactNode } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';

export type PageState =
  | { kind: 'loading'; label: ReactNode }
  | { kind: 'error'; message: ReactNode; retry?: { label: ReactNode; onRetry: () => void } }
  | { kind: 'empty'; title: ReactNode; body?: ReactNode; action?: ReactNode };

interface StatusViewProps {
  state: PageState;
  surface?: boolean;
  'data-testid'?: string;
}

export const StatusView = ({ state, surface = true, 'data-testid': testId }: StatusViewProps) => {
  switch (state.kind) {
    case 'loading':
      return (
        <Typography variant="h2" component="p" data-testid={testId}>
          {state.label}
        </Typography>
      );
    case 'error':
      return (
        <Box data-testid={testId}>
          <Alert severity="error">{state.message}</Alert>
          {state.retry === undefined ? null : (
            <Box sx={{ mt: '0.75rem' }}>
              <Button variant="outlined" onClick={state.retry.onRetry}>
                {state.retry.label}
              </Button>
            </Box>
          )}
        </Box>
      );
    case 'empty': {
      const content = (
        <Stack
          useFlexGap
          sx={{ rowGap: '0.75rem' }}
          {...(surface ? {} : { 'data-testid': testId, 'data-state': state.kind })}
        >
          <Typography variant="h2">{state.title}</Typography>
          {state.body === undefined ? null : (
            <Typography variant="body1" component="div">
              {state.body}
            </Typography>
          )}
          {state.action === undefined ? null : <Box sx={{ mt: '0.25rem' }}>{state.action}</Box>}
        </Stack>
      );

      return surface ? (
        <Paper variant="outlined" sx={{ p: '2.5rem' }} data-testid={testId} data-state={state.kind}>
          {content}
        </Paper>
      ) : (
        content
      );
    }
  }
};
