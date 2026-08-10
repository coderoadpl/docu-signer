import { Alert, Snackbar } from '@mui/material';
import { useSyncExternalStore } from 'react';

import { appNoticeStore } from '../../lib/app-notice.js';

export const AppNoticeSnackbar = () => {
  const notice = useSyncExternalStore(appNoticeStore.subscribe, appNoticeStore.snapshot);

  return (
    <Snackbar
      open={notice !== null}
      autoHideDuration={8000}
      onClose={() => appNoticeStore.dismiss()}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Alert severity="warning" variant="filled" onClose={() => appNoticeStore.dismiss()}>
        {notice?.message ?? ''}
      </Alert>
    </Snackbar>
  );
};
