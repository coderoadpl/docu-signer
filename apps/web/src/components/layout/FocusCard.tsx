import type { ReactNode } from 'react';
import { Box, Paper, Stack } from '@mui/material';

const FOCUS_CARD_WIDTH = '26rem';

interface FocusCardProps {
  header: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}

export const FocusCard = ({ header, action, children }: FocusCardProps) => (
  <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
    <Paper
      variant="outlined"
      sx={{ width: '100%', maxWidth: FOCUS_CARD_WIDTH, px: '1.8rem', pt: '2rem', pb: '1.6rem' }}
    >
      <Stack direction="row" sx={{ alignItems: 'baseline', mb: '1.4rem' }}>
        {header}
        <Box sx={{ flex: 1 }} />
        {action}
      </Stack>
      {children}
    </Paper>
  </Box>
);
