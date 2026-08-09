import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { ApiTokenScope } from '#core/domain/index.js';

import { apiTokenActions } from '../../api.js';
import { formatPolishDate } from '../../lib/format-date.js';

const API_TOKEN_SCOPE_OPTIONS = [
  {
    scope: 'read',
    label: 'Odczyt',
    description: 'Pozwala pobierać dokumenty i metadane.',
  },
  {
    scope: 'write',
    label: 'Zapis',
    description: 'Pozwala tworzyć i zmieniać zatwierdzone dokumenty.',
  },
  {
    scope: 'write:draft',
    label: 'Zapis szkiców',
    description: 'Tworzy wyłącznie szkice; nie może usuwać ani zatwierdzać.',
  },
] satisfies Array<{
  scope: ApiTokenScope;
  label: string;
  description: string;
}>;

const errorText = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd';

const scopeLabel = (scope: ApiTokenScope): string =>
  API_TOKEN_SCOPE_OPTIONS.find((option) => option.scope === scope)?.label ?? scope;

export const ApiTokenSection = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiTokenScope[]>(['read']);
  const [createdValue, setCreatedValue] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const apiTokens = useQuery(apiTokenActions.apiTokens);
  const create = useMutation({
    ...apiTokenActions.createApiToken,
    onSuccess: async ({ value }) => {
      setName('');
      setScopes(['read']);
      setCreatedValue(value);
      await queryClient.invalidateQueries(apiTokenActions.apiTokensInvalidates());
    },
  });
  const revoke = useMutation({
    ...apiTokenActions.revokeApiToken,
    onSuccess: async () => {
      setConfirmingId(null);
      await queryClient.invalidateQueries(apiTokenActions.apiTokensInvalidates());
    },
  });

  const rows = apiTokens.data?.apiTokens ?? [];
  const toggleScope = (scope: ApiTokenScope, checked: boolean) => {
    setScopes((current) =>
      checked
        ? Array.from(new Set([...current, scope]))
        : current.filter((selected) => selected !== scope),
    );
  };
  const submit = () => {
    setCreatedValue(null);
    create.mutate({ name: name.trim(), scopes });
  };

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Tokeny API</Typography>
      <Typography variant="body2" sx={{ mt: '0.3rem', mb: '0.8rem' }}>
        Utwórz osobisty token do automatyzacji dostępu do archiwum.
      </Typography>

      <Stack useFlexGap spacing="0.8rem">
        <FormControl>
          <FormLabel htmlFor="api-token-name">Nazwa tokenu</FormLabel>
          <OutlinedInput
            id="api-token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="np. Importer"
            inputProps={{ maxLength: 120 }}
          />
        </FormControl>
        <FormControl component="fieldset">
          <FormLabel component="legend">Zakresy</FormLabel>
          <FormGroup>
            {API_TOKEN_SCOPE_OPTIONS.map((option) => (
              <FormControlLabel
                key={option.scope}
                control={
                  <Checkbox
                    checked={scopes.includes(option.scope)}
                    onChange={(event) => toggleScope(option.scope, event.target.checked)}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{option.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.description}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </FormGroup>
        </FormControl>
        <Box>
          <Button
            variant="contained"
            disabled={create.isPending || name.trim().length === 0 || scopes.length === 0}
            onClick={submit}
          >
            {create.isPending ? 'Tworzenie…' : 'Utwórz token'}
          </Button>
        </Box>
        {createdValue ? (
          <Alert severity="warning">
            <Stack useFlexGap spacing="0.7rem">
              <Typography variant="body2">
                Skopiuj token teraz. Pełna wartość nie będzie już nigdy pokazana.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem">
                <OutlinedInput
                  readOnly
                  value={createdValue}
                  inputProps={{ 'aria-label': 'Wartość tokenu' }}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  onClick={() => {
                    void navigator.clipboard?.writeText(createdValue);
                  }}
                >
                  Kopiuj
                </Button>
              </Stack>
            </Stack>
          </Alert>
        ) : null}
        {create.isError ? <Alert severity="error">{errorText(create.error)}</Alert> : null}
      </Stack>

      {apiTokens.isPending ? (
        <Typography variant="body2" sx={{ mt: '0.8rem' }}>
          Ładowanie tokenów…
        </Typography>
      ) : null}
      {apiTokens.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>
          {errorText(apiTokens.error)}
        </Alert>
      ) : null}
      {rows.length > 0 ? (
        <List sx={{ mt: '0.8rem' }}>
          {rows.map((apiToken) => {
            const revoked = apiToken.revokedAt !== null;
            return (
              <ListItem
                key={apiToken.id}
                disableGutters
                secondaryAction={
                  revoked ? (
                    <Chip size="small" variant="outlined" label="Odwołany" />
                  ) : confirmingId === apiToken.id ? (
                    <Stack direction="row" useFlexGap spacing="0.4rem">
                      <Button
                        size="small"
                        color="error"
                        variant="contained"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(apiToken.id)}
                      >
                        Potwierdź
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        disabled={revoke.isPending}
                        onClick={() => setConfirmingId(null)}
                      >
                        Anuluj
                      </Button>
                    </Stack>
                  ) : (
                    <Button
                      size="small"
                      color="error"
                      variant="text"
                      onClick={() => setConfirmingId(apiToken.id)}
                    >
                      Odwołaj
                    </Button>
                  )
                }
              >
                <ListItemText
                  primary={apiToken.name}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Stack useFlexGap spacing="0.4rem">
                      <Stack direction="row" useFlexGap spacing="0.4rem" sx={{ flexWrap: 'wrap' }}>
                        {apiToken.scopes.map((scope) => (
                          <Chip key={scope} size="small" label={scopeLabel(scope)} />
                        ))}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Ostatnio użyty: {apiToken.lastUsedAt ? formatPolishDate(apiToken.lastUsedAt) : 'Nigdy'}
                      </Typography>
                    </Stack>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      ) : apiTokens.isSuccess ? (
        <Typography variant="body2" sx={{ mt: '0.8rem' }}>
          Nie utworzono jeszcze żadnych tokenów.
        </Typography>
      ) : null}
      {revoke.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>
          {errorText(revoke.error)}
        </Alert>
      ) : null}
    </Paper>
  );
};
