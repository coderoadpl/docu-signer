import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  SvgIcon,
  TextField,
  ThemeProvider,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createLink,
  Link as RouterLink,
  Outlet,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { SavedSearch } from '#core/domain/index.js';

import { actions, savedSearchActions } from './api.js';
import { AppShell } from './components/layout/AppShell.js';
import type { PageState } from './components/layout/StatusView.js';
import {
  documentsSearchFromState,
  toDocumentFilterValues,
} from './features/documents/documents.logic.js';
import { useAppTheme, Wordmark } from './theme.js';

const errorCodeOf = (error: Error | null): string | null =>
  error instanceof ApiError ? error.appError.code : null;

const APP_HOME = '/app';

const noArchiveAccessState: PageState = {
  kind: 'empty',
  title: 'Brak dostępu do archiwum',
  body: 'To konto nie jest przypisane do archiwum dokumentów.',
};

const MoreVertIcon = () => (
  <SvgIcon fontSize="small">
    <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  </SvgIcon>
);

const RouterListItemButton = createLink(ListItemButton);

const useSignOut = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });
};

export const AppLayout = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const me = useQuery(actions.me);
  const code = errorCodeOf(me.error);
  const unauthorized = code === 'unauthorized';
  const settledUnauthorized = unauthorized && !me.isFetching;
  const forbidden = code === 'forbidden';

  useEffect(() => {
    if (!settledUnauthorized) return;
    const deepLink = router.state.location.href;
    void navigate({
      to: '/login',
      search: deepLink === APP_HOME ? {} : { redirect: deepLink },
    });
  }, [settledUnauthorized, navigate, router]);

  if (me.isPending || (unauthorized && me.isFetching)) {
    return <Shell state={{ kind: 'loading', label: 'Ładowanie aplikacji…' }} />;
  }
  if (settledUnauthorized) return null;
  if (forbidden) {
    return <Shell state={noArchiveAccessState} />;
  }
  if (me.isError || !me.data) {
    return (
      <Shell
        state={{ kind: 'error', message: me.error?.message ?? 'Wystąpił nieoczekiwany błąd' }}
      />
    );
  }
  if (!me.data.tenant) {
    return <Shell displayName={me.data.name} state={noArchiveAccessState} />;
  }

  return <Shell tenant={me.data.tenant} displayName={me.data.name} />;
};

interface ShellProps {
  tenant?: { slug: string; name: string } | null;
  displayName?: string;
  state?: PageState;
}

const Shell = ({ tenant = null, displayName, state }: ShellProps) => {
  const signOut = useSignOut();
  const joinPad = useMutation(actions.joinOwnPadSession);
  const navigate = useNavigate();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [savedSearchMenuAnchor, setSavedSearchMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuSavedSearch, setMenuSavedSearch] = useState<SavedSearch | null>(null);
  const [renameSavedSearch, setRenameSavedSearch] = useState<SavedSearch | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteSavedSearchTarget, setDeleteSavedSearchTarget] = useState<SavedSearch | null>(null);
  const savedSearches = useQuery({
    ...savedSearchActions.savedSearches,
    enabled: Boolean(tenant),
  });
  const trashedDocuments = useQuery({
    ...actions.trashedDocuments,
    enabled: Boolean(tenant),
  });
  const pendingSourceUpdates = useQuery({
    ...actions.pendingSourceUpdateRequests,
    enabled: Boolean(tenant),
  });
  const createSavedSearch = useMutation(savedSearchActions.createSavedSearch);
  const deleteSavedSearch = useMutation({
    ...savedSearchActions.deleteSavedSearch,
    onSuccess: async () => {
      setDeleteSavedSearchTarget(null);
      await queryClient.invalidateQueries(savedSearchActions.savedSearchesInvalidates());
    },
  });
  const savedSearchItems = savedSearches.data?.savedSearches ?? [];
  const trashCount = trashedDocuments.data?.documents.length ?? 0;
  const pendingSourceUpdateCount = pendingSourceUpdates.data?.requests.length ?? 0;

  const closeSavedSearchMenu = () => {
    setSavedSearchMenuAnchor(null);
    setMenuSavedSearch(null);
  };

  const submitRename = async () => {
    const target = renameSavedSearch;
    const name = renameValue.trim();
    if (!target || !name || name === target.name) return;
    try {
      await createSavedSearch.mutateAsync({ name, filter: target.filter });
      await deleteSavedSearch.mutateAsync(target.id);
      setRenameSavedSearch(null);
      setRenameValue('');
    } catch {
      return;
    }
  };

  const navigation = (
    <>
      <ListItemButton
        className="app-shell-nav-item"
        component={RouterLink}
        to="/app/documents"
        activeOptions={{ includeSearch: false }}
      >
        <ListItemText primary="Dokumenty" />
      </ListItemButton>
      {savedSearchItems.length > 0 ? (
        <Box sx={{ mt: 1 }}>
          <Typography variant="overline" sx={{ display: 'block', pl: 4, pr: 2 }}>
            TECZKI
          </Typography>
          {savedSearchItems.map((savedSearch) => {
            const presetSearch = documentsSearchFromState(
              'list',
              toDocumentFilterValues(savedSearch.filter),
            );
            return (
              <ListItem
                key={savedSearch.id}
                component="div"
                disablePadding
                className="saved-search-row"
                secondaryAction={
                  <IconButton
                    className="saved-search-actions"
                    size="small"
                    aria-label={`Więcej akcji dla teczki ${savedSearch.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSavedSearchMenuAnchor(event.currentTarget);
                      setMenuSavedSearch(savedSearch);
                    }}
                  >
                    <MoreVertIcon />
                  </IconButton>
                }
                sx={{
                  '& .saved-search-actions': {
                    opacity: { xs: 1, md: 0 },
                    transition: 'opacity 120ms ease',
                  },
                  '&:hover .saved-search-actions, &:focus-within .saved-search-actions': {
                    opacity: 1,
                  },
                }}
              >
                <RouterListItemButton
                  className="app-shell-nav-item"
                  to="/app/documents"
                  search={presetSearch}
                  activeOptions={{ exact: true }}
                  sx={{ pl: 4, pr: 5 }}
                >
                  <ListItemText
                    primary={savedSearch.name}
                    slotProps={{ primary: { noWrap: true } }}
                  />
                </RouterListItemButton>
              </ListItem>
            );
          })}
        </Box>
      ) : null}
      <ListItemButton
        className="app-shell-nav-item"
        component={RouterLink}
        to="/app/source-updates"
        activeOptions={{ exact: true, includeSearch: false }}
      >
        <ListItemText primary="Aktualizacje źródeł" />
        {pendingSourceUpdateCount > 0 ? (
          <Chip size="small" variant="outlined" label={pendingSourceUpdateCount} />
        ) : null}
      </ListItemButton>
      <ListItemButton
        className="app-shell-nav-item"
        component={RouterLink}
        to="/app/kosz"
        activeOptions={{ exact: true, includeSearch: false }}
      >
        <ListItemText primary="Kosz" />
        {trashCount > 0 ? (
          <Chip size="small" variant="outlined" label={trashCount} />
        ) : null}
      </ListItemButton>
      <Divider sx={{ my: 1.5 }} />
      <ListItemButton
        className="app-shell-nav-item"
        component={RouterLink}
        to="/app/settings"
        activeOptions={{ includeSearch: false }}
      >
        <ListItemText primary="Konto" />
      </ListItemButton>
      <Menu
        anchorEl={savedSearchMenuAnchor}
        open={Boolean(savedSearchMenuAnchor)}
        onClose={closeSavedSearchMenu}
      >
        <MenuItem
          onClick={() => {
            const savedSearch = menuSavedSearch;
            closeSavedSearchMenu();
            if (!savedSearch) return;
            setRenameSavedSearch(savedSearch);
            setRenameValue(savedSearch.name);
          }}
        >
          Zmień nazwę
        </MenuItem>
        <MenuItem
          onClick={() => {
            const savedSearch = menuSavedSearch;
            closeSavedSearchMenu();
            if (savedSearch) setDeleteSavedSearchTarget(savedSearch);
          }}
        >
          Usuń
        </MenuItem>
      </Menu>
    </>
  );

  return (
    <ThemeProvider theme={theme}>
      <AppShell
        brand={
          <RouterLink to="/app" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Wordmark variant="h2">Podpisy</Wordmark>
          </RouterLink>
        }
        context={
          tenant ? (
            <Typography variant="h6" component="p" noWrap>
              {tenant.name}
            </Typography>
          ) : null
        }
        meta={
          displayName ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              {displayName}
            </Typography>
          ) : null
        }
        actions={
          <>
            {tenant ? (
              <Button
                className="coarse-pad-action"
                variant="text"
                size="small"
                disabled={joinPad.isPending}
                onClick={() => {
                  joinPad.mutate(undefined, {
                    onSuccess: ({ session }) => {
                      void navigate({
                        to: '/pad/$sessionId',
                        params: { sessionId: session.id },
                      });
                    },
                  });
                }}
              >
                Tryb pada
              </Button>
            ) : null}
            <Button
              variant="text"
              size="small"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Wyloguj się
            </Button>
          </>
        }
        navigation={tenant ? navigation : null}
        {...(state === undefined ? {} : { state })}
      >
        <Outlet />
      </AppShell>
      <Dialog
        open={Boolean(renameSavedSearch)}
        onClose={() => {
          setRenameSavedSearch(null);
          setRenameValue('');
          createSavedSearch.reset();
          deleteSavedSearch.reset();
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Zmień nazwę teczki</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Nazwa"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          {createSavedSearch.isError || deleteSavedSearch.isError ? (
            <Typography color="error" variant="body2" sx={{ mt: 1 }}>
              {createSavedSearch.error?.message ?? deleteSavedSearch.error?.message}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setRenameSavedSearch(null);
              setRenameValue('');
            }}
          >
            Anuluj
          </Button>
          <Button
            variant="contained"
            disabled={
              !renameSavedSearch ||
              !renameValue.trim() ||
              renameValue.trim() === renameSavedSearch.name ||
              createSavedSearch.isPending ||
              deleteSavedSearch.isPending
            }
            onClick={() => void submitRename()}
          >
            Zapisz
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(deleteSavedSearchTarget)}
        onClose={() => {
          setDeleteSavedSearchTarget(null);
          deleteSavedSearch.reset();
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Usunąć teczkę?</DialogTitle>
        <DialogContent>
          <Typography>
            Teczka „{deleteSavedSearchTarget?.name ?? ''}” zostanie usunięta. Dokumenty
            pozostaną w archiwum.
          </Typography>
          {deleteSavedSearch.isError ? (
            <Typography color="error" variant="body2" sx={{ mt: 1 }}>
              {deleteSavedSearch.error.message}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteSavedSearchTarget(null)}>Anuluj</Button>
          <Button
            variant="contained"
            color="error"
            disabled={!deleteSavedSearchTarget || deleteSavedSearch.isPending}
            onClick={() => {
              if (deleteSavedSearchTarget) {
                deleteSavedSearch.mutate(deleteSavedSearchTarget.id);
              }
            }}
          >
            Usuń
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
};
