import {
  Alert,
  FormControlLabel,
  Paper,
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
  const checked = settings.data?.settings.storeSignatureRecords ?? true;

  return (
    <Paper variant="outlined" sx={{ p: '1.25rem', mt: '1.5rem' }}>
      <Typography variant="overline">Ustawienia organizacji</Typography>
      <FormControlLabel
        sx={{ mt: '0.35rem', alignItems: 'flex-start' }}
        control={
          <Switch
            checked={checked}
            disabled={settings.isPending || settings.isError || update.isPending}
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
