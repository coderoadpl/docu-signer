import { Box, Button, Paper, Typography } from '@mui/material';

import { ApiError } from '#core/client/index.js';

import { activeTraceId } from './observability.js';

const headingFor = (error: unknown): string => {
  if (!(error instanceof ApiError)) return 'Wystąpił błąd';
  switch (error.appError.code) {
    case 'unauthorized':
      return 'Sesja wygasła';
    case 'forbidden':
      return 'Nie masz dostępu';
    case 'not_found':
      return 'Nie znaleziono zasobu';
    case 'tenant_not_found':
      return 'Nieznana firma';
    case 'validation':
      return 'Żądanie jest nieprawidłowe';
    case 'conflict':
      return 'Wystąpił konflikt zmian';
    case 'export_too_large':
      return 'Eksport jest zbyt duży';
    case 'unavailable':
      return 'Usługa jest tymczasowo niedostępna';
    case 'internal':
      return 'Wystąpił błąd';
  }
};

const detailFor = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : 'Nieoczekiwany błąd przerwał działanie strony.';

interface RootErrorFallbackProps {
  error: unknown;
  traceId: string | undefined;
}

/**
 * Presentational fallback for the root error boundary. Shows the taxonomy-aware
 * message and, whenever tracing is active, the trace id so a user can paste it
 * into a support request; it is simply absent when tracing is not configured.
 */
export const RootErrorFallback = ({ error, traceId }: RootErrorFallbackProps) => (
  <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
    <Paper
      variant="outlined"
      role="alert"
      sx={{ width: '100%', maxWidth: '23rem', px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
    >
      <Typography variant="h1" sx={{ mb: '0.4rem' }}>
        {headingFor(error)}
      </Typography>
      <Typography variant="body2" sx={{ mb: '1.4rem' }}>
        {detailFor(error)}
      </Typography>
      {traceId === undefined ? null : (
        <Typography variant="caption" component="p" sx={{ mb: '1.4rem' }}>
          Identyfikator śledzenia: <code>{traceId}</code>
        </Typography>
      )}
      <Button variant="contained" fullWidth onClick={() => window.location.reload()}>
        Odśwież stronę
      </Button>
    </Paper>
  </Box>
);

/** Render-prop entry for the boundary: binds the live trace id. */
export const renderRootErrorFallback = (error: unknown) => (
  <RootErrorFallback error={error} traceId={activeTraceId()} />
);
