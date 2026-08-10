import {
  Alert,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';

const errorText = (error: unknown): string =>
  error instanceof ApiError
    ? error.appError.message
    : error instanceof Error
      ? error.message
      : 'Wystąpił nieoczekiwany błąd';

export const TenantSettingsSection = () => {
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const update = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });
  const stored = settings.data?.settings;
  const disabled = settings.isPending || settings.isError || update.isPending;

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Ustawienia organizacji</Typography>
      <Stack sx={{ mt: '0.35rem', gap: 1.5 }}>
        <FormControlLabel
          sx={{ alignItems: 'flex-start' }}
          control={
            <Switch
              checked={stored?.storeSignatureRecords ?? true}
              disabled={disabled}
              onChange={(event) =>
                update.mutate({ storeSignatureRecords: event.target.checked })
              }
            />
          }
          label={
            <Typography variant="body2" sx={{ pt: '0.5rem' }}>
              Przechowuj zapis podpisów (umożliwia przyszłe uaktualnianie źródła)
            </Typography>
          }
        />
        <FormControlLabel
          sx={{ alignItems: 'flex-start' }}
          control={
            <Switch
              checked={stored?.pdfSealEnabled ?? false}
              disabled={disabled}
              onChange={(event) =>
                update.mutate({ pdfSealEnabled: event.target.checked })
              }
            />
          }
          label={
            <Typography variant="body2" sx={{ pt: '0.5rem' }}>
              Pieczęć cyfrowa PDF (weryfikowalna w czytnikach PDF)
            </Typography>
          }
        />
        <FormControl size="small" disabled={disabled} sx={{ maxWidth: 520 }}>
          <InputLabel id="tenant-date-mode-label">Tryb dat</InputLabel>
          <Select
            labelId="tenant-date-mode-label"
            label="Tryb dat"
            value={stored?.dateMode ?? 'declared'}
            onChange={(event) =>
              update.mutate({ dateMode: event.target.value === 'actual' ? 'actual' : 'declared' })
            }
          >
            <MenuItem value="declared">Daty deklarowane (wpisywane ręcznie)</MenuItem>
            <MenuItem value="actual">Daty rzeczywiste (program zapisuje bieżącą datę)</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      {settings.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>
          {errorText(settings.error)}
        </Alert>
      ) : null}
      {update.isError ? (
        <Alert severity="error" sx={{ mt: '0.8rem' }}>
          {errorText(update.error)}
        </Alert>
      ) : null}
    </Paper>
  );
};
