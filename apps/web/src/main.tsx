import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  RouterProvider,
} from '@tanstack/react-router';

import { ErrorBoundary } from './components/ui/ErrorBoundary.js';
import { actions } from './api.js';
import { AppLayout } from './AppLayout.js';
import { initWebObservability, reportError } from './observability.js';
import { queryClient } from './query-client.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';
import { renderRootErrorFallback } from './RootErrorFallback.js';
import { BoardRoute } from './routes/board.js';
import { DocumentDetailRoute } from './routes/document-detail.js';
import { DocumentsRoute } from './routes/documents.js';
import { LoginRoute } from './routes/login.js';
import { MembersRoute } from './routes/members.js';
import { NotFoundRoute } from './routes/not-found.js';
import { RegisterRoute } from './routes/register.js';
import { DomainsRoute } from './routes/settings-domains.js';
import { StaffSettingsRoute } from './routes/settings-staff.js';
import { SettingsRoute } from './routes/settings.js';
import { TeamBoardRoute } from './routes/team-board.js';
import { TodosRoute } from './routes/todos.js';
import { createAppTheme } from './theme.js';

/** Dev-only, lazy so the devtools chunk never reaches the production bundle. */
const ReactQueryDevtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  })),
);

const rootRoute = createRootRoute({ component: Outlet });

// The bare root redirects into the authenticated app; `/app` is the single
// authenticated home (US-015). Keeping `/` as a redirect means any old bookmark
// or deep link to the origin still lands somewhere sensible.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/app' });
  },
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginRoute,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: RegisterRoute,
});

// The authenticated layout owns `/app/*`: it guards auth, redirects anonymous
// visitors to `/login`, and renders the active child through its `Outlet`.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppLayout,
  notFoundComponent: NotFoundRoute,
});
const AppIndexRedirect = () => {
  const me = useQuery(actions.me);
  if (me.isPending) return null;
  const staffRole = me.data?.tenant?.staffRole ?? null;
  return <Navigate to={staffRole ? '/app/documents' : '/app/ledger'} replace />;
};

const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  component: AppIndexRedirect,
});
const ledgerRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'ledger',
  component: TodosRoute,
});
const boardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'board',
  component: BoardRoute,
});
const teamBoardRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'team-board',
  component: TeamBoardRoute,
});
const membersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'members',
  component: MembersRoute,
});
const documentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents',
  component: DocumentsRoute,
});
const documentDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents/$id',
  component: DocumentDetailRoute,
});
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'settings',
  component: SettingsRoute,
});
const settingsStaffRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'settings/staff',
  component: StaffSettingsRoute,
});
const settingsDomainsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'settings/domains',
  component: DomainsRoute,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    registerRoute,
    appLayoutRoute.addChildren([
      appIndexRoute,
      ledgerRoute,
      boardRoute,
      teamBoardRoute,
      membersRoute,
      documentsRoute,
      documentDetailRoute,
      settingsRoute,
      settingsStaffRoute,
      settingsDomainsRoute,
    ]),
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

initWebObservability();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={createAppTheme()}>
      <CssBaseline />
      <ErrorBoundary fallback={renderRootErrorFallback} onError={reportError}>
        <QueryClientProvider client={queryClient}>
          <RefreshSnackbar />
          <RouterProvider router={router} />
          {import.meta.env.DEV ? (
            <Suspense fallback={null}>
              <ReactQueryDevtools />
            </Suspense>
          ) : null}
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
