import { QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { reportError } from './observability.js';
import { refreshToastStore } from './refresh-toast.js';

const MAX_RETRIES = 3;

/**
 * QueryCache is the single global error surface (one notice per failing query,
 * not per observer). Every failure is reported to Sentry (with the active trace
 * id) when configured. With data already on screen we keep it and toast the
 * refresh failure; with no data the query's local render or the root error
 * boundary handles it.
 */
const queryCache = new QueryCache({
  onError: (error, query) => {
    reportError(error);
    if (query.state.data === undefined) return;
    const message = error instanceof ApiError ? error.appError.message : 'Could not refresh data';
    refreshToastStore.show(message);
  },
});

/**
 * The one QueryClient, created at module scope. Application code reaches it via
 * `useQueryClient()`; only the composition root imports this singleton.
 */
export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (failureCount >= MAX_RETRIES) return false;
        if (error instanceof ApiError) return error.appError.code === 'internal';
        return true;
      },
    },
  },
});
