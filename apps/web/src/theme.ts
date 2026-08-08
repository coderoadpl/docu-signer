import type { ElementType } from 'react';
import { Box, Typography } from '@mui/material';
import { createTheme, styled, type Theme } from '@mui/material/styles';

export const createAppTheme = (accentHue?: number): Theme =>
  createTheme({
    ...(accentHue === undefined
      ? {}
      : { palette: { primary: { main: `hsl(${accentHue} 62% 42%)` } } }),
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

type AsElement = { component?: ElementType };

const CardTitle = styled(Typography)({ fontSize: '1.6rem' });

export const TenantName = styled('span')({ fontWeight: 700 });

export const Wordmark = styled(CardTitle)({ letterSpacing: 'normal' });

export const Eyebrow = styled(Typography)<AsElement>({ fontSize: '0.78rem' });

export const FinePrint = styled(Typography)<AsElement>({ fontSize: '0.75rem' });

export const EntryIndex = styled(Typography)(({ theme }) => ({
  fontSize: '0.78rem',
  color: theme.palette.primary.dark,
}));

export const EntryDate = styled(Typography)<AsElement & { dateTime?: string }>({
  whiteSpace: 'nowrap',
});

export const DemoValue = styled('code')(({ theme }) => ({ color: theme.palette.primary.dark }));

export const FileDropZone = styled(Box)(({ theme }) => ({
  border: `1px dashed ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
}));

export const PdfPreview = styled('object')(({ theme }) => ({
  display: 'block',
  width: '100%',
  minHeight: '32rem',
  border: `1px solid ${theme.palette.divider}`,
  backgroundColor: theme.palette.background.paper,
}));

export const PreviewImage = styled('img')({
  display: 'block',
  width: '100%',
  maxHeight: '32rem',
  objectFit: 'contain',
});
