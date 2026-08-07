import { ThemeProvider } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';

import type { ReactElement, ReactNode } from 'react';

import { createThemeForMode } from '../theme.js';

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

// jsdom fires no CSS transitionend, so MUI falls back to timer-driven exits;
// zeroing every duration makes dialog open/close settle on the next tick and
// keeps assertions off animation timing.
const testTheme = createTheme(createThemeForMode('logbook'), {
  transitions: {
    create: () => 'none',
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
  },
});

const TestProviders = ({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={testTheme}>{children}</ThemeProvider>
  </QueryClientProvider>
);

export const renderWithProviders = (ui: ReactElement, options?: RenderOptions) => {
  const queryClient = createTestQueryClient();

  return {
    queryClient,
    ...render(<TestProviders queryClient={queryClient}>{ui}</TestProviders>, options),
  };
};
