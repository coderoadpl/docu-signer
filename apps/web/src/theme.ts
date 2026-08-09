import type { ElementType } from 'react';
import { Box, Typography } from '@mui/material';
import { createTheme, styled, type Theme } from '@mui/material/styles';

export const createAppTheme = (accentHue?: number): Theme => {
  const base = createTheme({ palette: { contrastThreshold: 4.5 } });
  const primaryMain = accentHue === undefined
    ? base.palette.primary.main
    : `hsl(${accentHue}, 62%, 36%)`;

  return createTheme({
    palette: {
      primary: base.palette.augmentColor({
        color: { main: primaryMain },
        name: 'primary',
      }),
      secondary: base.palette.augmentColor({
        color: { main: base.palette.secondary.main },
        name: 'secondary',
      }),
    },
    typography: {
      h1: { fontSize: '2.125rem', fontWeight: 400 },
      h2: { fontSize: '1.25rem', fontWeight: 500 },
    },
    components: {
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.app-shell-nav-item': {
              borderLeft: '3px solid transparent',
            },
            '&.app-shell-nav-item.active': {
              borderLeftColor: theme.palette.primary.main,
              backgroundColor: theme.palette.action.selected,
            },
          }),
        },
      },
    },
  });
};

type AsElement = { component?: ElementType };

const CardTitle = styled(Typography)({ fontSize: '1.6rem' });

export const Wordmark = styled(CardTitle)({ letterSpacing: 'normal' });

export const Eyebrow = styled(Typography)<AsElement>({ fontSize: '0.78rem' });

export const FinePrint = styled(Typography)<AsElement>({ fontSize: '0.75rem' });

export const DemoValue = styled('code')(({ theme }) => ({ color: theme.palette.primary.dark }));

export const FileDropZone = styled(Box)(({ theme }) => ({
  border: `1px dashed ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
}));

export const SigningSurface = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
}));

export const SigningPageSurface = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.common.white,
  boxShadow: theme.shadows[4],
}));

export const InkSurface = styled('canvas')(({ theme }) => ({
  touchAction: 'none',
  cursor: 'crosshair',
  outline: `1px solid ${theme.palette.divider}`,
  '&:focus-visible': {
    outline: `3px solid ${theme.palette.primary.main}`,
  },
}));
