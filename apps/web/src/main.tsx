import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
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
import { PolishDatePickerProvider } from './components/ui/PolishDatePicker.js';
import { AppLayout } from './AppLayout.js';
import { AppNoticeSnackbar } from './components/ui/AppNoticeSnackbar.js';
import {
  documentReviewSearchSchema,
  documentSigningSearchSchema,
} from './features/documents/documents.logic.js';
import { initWebObservability, reportError } from './observability.js';
import { queryClient } from './query-client.js';
import { RefreshSnackbar } from './RefreshSnackbar.js';
import { renderRootErrorFallback } from './RootErrorFallback.js';
import { DocumentDetailRoute } from './routes/document-detail.js';
import {
  DocumentsRoute,
  documentsSearchSchema,
  legacyDocumentsRedirect,
} from './routes/documents.js';
import { ForgotPasswordRoute } from './routes/forgot-password.js';
import { LoginRoute } from './routes/login.js';
import { NotFoundRoute } from './routes/not-found.js';
import { PadRoute } from './routes/pad.js';
import { RegisterRoute } from './routes/register.js';
import { ResetPasswordRoute, resetPasswordSearchSchema } from './routes/reset-password.js';
import { SettingsRoute } from './routes/settings.js';
import { TrashRoute } from './routes/trash.js';
import { useAppTheme } from './theme.js';

/** Dev-only, lazy so the devtools chunk never reaches the production bundle. */
const ReactQueryDevtools = lazy(() =>
  import('@tanstack/react-query-devtools').then((module) => ({
    default: module.ReactQueryDevtools,
  })),
);

const LazyDocumentSigningRoute = lazy(() =>
  import('./routes/document-signing.js').then((module) => ({
    default: module.DocumentSigningRoute,
  })),
);

const DocumentSigningRoute = () => (
  <Suspense fallback={null}>
    <LazyDocumentSigningRoute />
  </Suspense>
);

const LazyDocumentReviewRoute = lazy(() =>
  import('./routes/document-review.js').then((module) => ({
    default: module.DocumentReviewRoute,
  })),
);

const DocumentReviewRoute = () => (
  <Suspense fallback={null}>
    <LazyDocumentReviewRoute />
  </Suspense>
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
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordRoute,
});
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: resetPasswordSearchSchema,
  component: ResetPasswordRoute,
});
const padRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pad/$sessionId',
  component: PadRoute,
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
  return <Navigate to="/app/documents" replace />;
};

const appIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/',
  component: AppIndexRedirect,
});
const documentsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents',
  validateSearch: documentsSearchSchema,
  beforeLoad: ({ location }) => {
    const target = legacyDocumentsRedirect(location.searchStr);
    if (target) throw redirect(target);
  },
  component: DocumentsRoute,
});
const trashRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'kosz',
  component: TrashRoute,
});
const documentDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents/$id',
  validateSearch: documentsSearchSchema,
  component: DocumentDetailRoute,
});
const documentSigningRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents/$id/sign/$fileId',
  validateSearch: documentSigningSearchSchema,
  component: DocumentSigningRoute,
});
const documentReviewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'documents/$id/review',
  validateSearch: documentReviewSearchSchema,
  component: DocumentReviewRoute,
});
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: 'settings',
  component: SettingsRoute,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    loginRoute,
    registerRoute,
    forgotPasswordRoute,
    resetPasswordRoute,
    padRoute,
    appLayoutRoute.addChildren([
      appIndexRoute,
      documentsRoute,
      trashRoute,
      documentDetailRoute,
      documentSigningRoute,
      documentReviewRoute,
      settingsRoute,
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

const AppRoot = () => {
  const theme = useAppTheme();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary fallback={renderRootErrorFallback} onError={reportError}>
        <PolishDatePickerProvider>
          <QueryClientProvider client={queryClient}>
            <RefreshSnackbar />
            <AppNoticeSnackbar />
            <RouterProvider router={router} />
            {import.meta.env.DEV ? (
              <Suspense fallback={null}>
                <ReactQueryDevtools />
              </Suspense>
            ) : null}
          </QueryClientProvider>
        </PolishDatePickerProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
};

createRoot(container).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
