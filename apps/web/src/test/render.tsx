import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';

import type { ReactElement, ReactNode } from 'react';
import 'dayjs/locale/pl.js';

const polishPickerLocaleText = {
  cancelButtonLabel: 'Anuluj',
  clearButtonLabel: 'Wyczyść',
  datePickerToolbarTitle: 'Wybierz datę',
  fieldClearLabel: 'Wyczyść',
  nextMonth: 'Następny miesiąc',
  okButtonLabel: 'Zatwierdź',
  openDatePickerDialogue: (formattedDate: string | null) =>
    formattedDate ? `Wybierz datę, obecnie wybrana data to ${formattedDate}` : 'Wybierz datę',
  previousMonth: 'Poprzedni miesiąc',
  todayButtonLabel: 'Dzisiaj',
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

const TestProviders = ({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) => (
  <LocalizationProvider
    dateAdapter={AdapterDayjs}
    adapterLocale="pl"
    localeText={polishPickerLocaleText}
  >
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </LocalizationProvider>
);

export const renderWithProviders = (ui: ReactElement, options?: RenderOptions) => {
  const queryClient = createTestQueryClient();

  return {
    queryClient,
    ...render(<TestProviders queryClient={queryClient}>{ui}</TestProviders>, options),
  };
};
