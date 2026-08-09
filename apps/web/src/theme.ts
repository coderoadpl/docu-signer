import { useMemo, type ElementType } from 'react';
import { Box, TableCell, Typography } from '@mui/material';
import { createTheme, styled, type Theme, type ThemeOptions } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';

const reducedMotionTransitions = {
  create: () => 'none',
  duration: {
    shortest: 0,
    shorter: 0,
    short: 0,
    standard: 0,
    complex: 0,
    enteringScreen: 0,
    leavingScreen: 0,
  },
  getAutoHeightDuration: () => 0,
} satisfies ThemeOptions['transitions'];

interface AppThemeOptions {
  accentHue?: number;
  prefersReducedMotion?: boolean;
}

const reducedMotionMediaQuery = '(prefers-reduced-motion: reduce)';

export const DEFAULT_PRIMARY = 'hsl(215, 35%, 34%)';

const FONT_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

export const createAppTheme = ({
  accentHue,
  prefersReducedMotion = false,
}: AppThemeOptions = {}): Theme => {
  const base = createTheme({ palette: { contrastThreshold: 4.5 } });
  const primaryMain = accentHue === undefined
    ? DEFAULT_PRIMARY
    : `hsl(${accentHue}, 62%, 36%)`;

  return createTheme({
    ...(prefersReducedMotion ? { transitions: reducedMotionTransitions } : {}),
    palette: {
      contrastThreshold: 4.5,
      primary: base.palette.augmentColor({
        color: { main: primaryMain },
        name: 'primary',
      }),
      secondary: base.palette.augmentColor({
        color: { main: base.palette.secondary.main },
        name: 'secondary',
      }),
      background: {
        default: '#f6f6f4',
        paper: '#ffffff',
      },
      text: {
        primary: '#1c2733',
        secondary: '#5a6572',
      },
      divider: 'rgba(28, 39, 51, 0.14)',
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: FONT_STACK,
      h1: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.25 },
      h2: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },
      h3: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
      h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
      overline: {
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.08em',
        lineHeight: 2,
      },
    },
    components: {
      ...(prefersReducedMotion
        ? {}
        : {
            MuiCssBaseline: {
              styleOverrides: {
                '@keyframes settle': {
                  from: { opacity: 0, transform: 'translateY(0.4rem)' },
                  to: { opacity: 1, transform: 'none' },
                },
              },
            },
          }),
      MuiButtonBase: {
        defaultProps: {
          disableRipple: prefersReducedMotion,
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          sizeMedium: { minHeight: '2.75rem', paddingInline: '1.1rem' },
          sizeSmall: { minHeight: '2.25rem' },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          // WHY: signing and file actions are used with fingers on iPad; small
          // icon buttons must still hit the 44px touch-target floor.
          sizeSmall: { padding: '0.625rem' },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 500 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, fontSize: '0.9375rem' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: theme.palette.text.secondary,
            whiteSpace: 'nowrap',
          }),
        },
      },
      MuiTypography: {
        styleOverrides: {
          overline: ({ theme }) => ({ color: theme.palette.text.secondary }),
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontSize: '1.125rem', fontWeight: 600 },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          colorDefault: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
          }),
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.app-shell-nav-item': {
              borderRadius: theme.shape.borderRadius,
              margin: '0.125rem 0.75rem',
              minHeight: '2.75rem',
            },
            '&.app-shell-nav-item.active': {
              backgroundColor: theme.palette.action.selected,
              '& .MuiListItemText-primary': {
                fontWeight: 600,
                color: theme.palette.primary.main,
              },
            },
          }),
        },
      },
    },
  });
};

export const useAppTheme = ({ accentHue }: Pick<AppThemeOptions, 'accentHue'> = {}): Theme => {
  // WHY: reduced motion is an accessibility preference, so it must shape the product theme itself.
  const prefersReducedMotion = useMediaQuery(reducedMotionMediaQuery, { noSsr: true });
  return useMemo(
    () => createAppTheme(
      accentHue === undefined ? { prefersReducedMotion } : { accentHue, prefersReducedMotion },
    ),
    [accentHue, prefersReducedMotion],
  );
};

type AsElement = { component?: ElementType };

const CardTitle = styled(Typography)({ fontSize: '1.5rem', fontWeight: 700 });

export const Wordmark = styled(CardTitle)({ letterSpacing: '-0.015em' });

export const Eyebrow = styled(Typography)<AsElement>({ fontSize: '0.78rem' });

export const FinePrint = styled(Typography)<AsElement>({ fontSize: '0.75rem' });

export const DemoValue = styled('code')(({ theme }) => ({ color: theme.palette.primary.dark }));

export const FileDropZone = styled(Box)(({ theme }) => ({
  border: `1px dashed ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.secondary,
  textAlign: 'center',
}));

export const SigningSurface = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
}));

export const StickyTableCell = styled(TableCell)(({ theme }) => ({
  backgroundColor: theme.palette.background.paper,
}));

export const SigningPageSurface = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.common.white,
  boxShadow: theme.shadows[4],
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
}));

export const InkSurface = styled('canvas')(({ theme }) => ({
  touchAction: 'none',
  cursor: 'crosshair',
  outline: `1px solid ${theme.palette.divider}`,
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
  '&:focus-visible': {
    outline: `3px solid ${theme.palette.primary.main}`,
  },
}));
