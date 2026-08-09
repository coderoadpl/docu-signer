import type { ReactNode } from 'react';
import { Box } from '@mui/material';

import { SigningSurface } from '../../theme.js';

export const SigningShell = ({
  header,
  controls,
  children,
  footer,
  fitMain,
}: {
  header: ReactNode;
  controls: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  fitMain?: boolean;
}) => (
  <SigningSurface
    sx={{
      position: 'fixed',
      inset: 0,
      zIndex: 'modal',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      '& *': {
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      },
    }}
  >
    <Box component="header" sx={{ flex: '0 0 auto' }}>
      {header}
    </Box>
    <Box sx={{ flex: '0 0 auto' }}>{controls}</Box>
    <Box
      component="main"
      sx={{
        flex: '1 1 auto',
        minHeight: 0,
        overflow: fitMain ? 'hidden' : 'auto',
        p: { xs: 1, md: 2 },
        ...(fitMain
          ? {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }
          : {}),
      }}
    >
      {children}
    </Box>
    <Box component="footer" sx={{ flex: '0 0 auto' }}>
      {footer}
    </Box>
  </SigningSurface>
);
