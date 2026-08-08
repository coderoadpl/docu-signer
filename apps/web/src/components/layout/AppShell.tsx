import { useState, type ReactNode } from 'react';
import {
  AppBar,
  Box,
  Container,
  Divider,
  Drawer,
  IconButton,
  Stack,
  SvgIcon,
  Toolbar,
} from '@mui/material';

import { StatusView, type PageState } from './StatusView.js';

const APP_CONTENT_WIDTH = '44rem';
const SIDEBAR_WIDTH = '15rem';

interface AppShellProps {
  brand: ReactNode;
  context?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  navigation: ReactNode;
  state?: PageState;
  children?: ReactNode;
}

const MenuIcon = () => (
  <SvgIcon>
    <path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
  </SvgIcon>
);

const CloseIcon = () => (
  <SvgIcon>
    <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
  </SvgIcon>
);

const Sidebar = ({
  brand,
  navigation,
  onNavigate,
  onClose,
}: {
  brand: ReactNode;
  navigation: ReactNode;
  onNavigate?: () => void;
  onClose?: () => void;
}) => (
  <Stack sx={{ height: '100%' }}>
    <Stack
      direction="row"
      sx={{ minHeight: '4.5rem', px: 3, py: 1.5, alignItems: 'center', gap: 1 }}
    >
      <Box sx={{ flex: 1 }}>{brand}</Box>
      {onClose ? (
        <IconButton aria-label="Zamknij nawigację" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      ) : null}
    </Stack>
    <Divider />
    <Box component="nav" aria-label="Główna nawigacja" onClick={onNavigate} sx={{ py: 1.5 }}>
      {navigation}
    </Box>
  </Stack>
);

export const AppShell = ({
  brand,
  context,
  meta,
  actions,
  navigation,
  state,
  children,
}: AppShellProps) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant="permanent"
        open
        sx={{
          display: { xs: 'none', md: 'block' },
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Sidebar brand={brand} navigation={navigation} />
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' },
        }}
      >
        <Sidebar
          brand={brand}
          navigation={navigation}
          onNavigate={() => setMobileOpen(false)}
          onClose={() => setMobileOpen(false)}
        />
      </Drawer>
      <Box sx={{ display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column' }}>
        <AppBar position="sticky" color="default" elevation={0}>
          <Toolbar sx={{ gap: 1.5 }}>
            <IconButton
              edge="start"
              aria-label="Otwórz nawigację"
              onClick={() => setMobileOpen(true)}
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            {context}
            <Box sx={{ flex: 1 }} />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              {meta}
              {actions}
            </Stack>
          </Toolbar>
          <Divider />
        </AppBar>
        <Box component="main" sx={{ flex: 1 }}>
          {state === undefined ? (
            children
          ) : (
            <Container data-testid="app-shell-status" sx={{ maxWidth: APP_CONTENT_WIDTH, py: 6 }}>
              <StatusView state={state} />
            </Container>
          )}
        </Box>
      </Box>
    </Box>
  );
};
