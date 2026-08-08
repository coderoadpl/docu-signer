import type { ReactNode } from 'react';
import { AppBar, Box, Container, Divider, Stack, Toolbar } from '@mui/material';

import { StatusView, type PageState } from './StatusView.js';

const APP_CONTENT_WIDTH = '44rem';

interface AppShellProps {
  brand: ReactNode;
  context?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  navigation: ReactNode;
  state?: PageState;
  children?: ReactNode;
}

export const AppShell = ({
  brand,
  context,
  meta,
  actions,
  navigation,
  state,
  children,
}: AppShellProps) => (
  <>
    <AppBar position="static" color="transparent" elevation={0}>
      <Toolbar sx={{ gap: '1rem', flexWrap: 'wrap' }}>
        {brand}
        {context}
        <Box sx={{ flex: 1 }} />
        {meta}
        {actions}
      </Toolbar>
      <Stack
        component="nav"
        direction="row"
        useFlexGap
        sx={{ flexWrap: 'wrap', columnGap: '1.2rem', rowGap: '0.3rem', px: '1.5rem', pb: '0.6rem' }}
      >
        {navigation}
      </Stack>
    </AppBar>
    <Divider />
    <Box component="main">
      {state === undefined ? (
        children
      ) : (
        <Container data-testid="app-shell-status" sx={{ maxWidth: APP_CONTENT_WIDTH, py: 6 }}>
          <StatusView state={state} />
        </Container>
      )}
    </Box>
  </>
);
