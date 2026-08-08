import type { ElementType } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, createTheme, styled, type Theme } from '@mui/material/styles';

/**
 * The entire "engineer's logbook" visual language lives in this theme:
 * colors, fonts and component overrides. Pages only use MUI components
 * with their stock props/variants, plus `sx` for layout and spacing.
 * The accent hue is derived from the tenant slug, so each tenant gets
 * its own theme instance via a nested ThemeProvider.
 *
 * Values mirror the original hand-written stylesheet 1:1 (pixel-diffed
 * against it); do not "round" them to Material defaults.
 */

const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";
const FONT_DISPLAY =
  "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";

export const PAPER = '#f6f2ea';
export const PAPER_RAISED = '#fdfbf6';
export const INK = '#191512';
export const INK_SOFT = '#5c5348';
export const LINE = 'rgba(25, 21, 18, 0.14)';
export const LINE_STRONG = 'rgba(25, 21, 18, 0.55)';

export type ThemeMode = 'logbook' | 'material';

/**
 * Stock Material UI look. Only the per-tenant accent carries over as the
 * primary color; h1/h2 are scaled down to page-title sizes (raw MUI h1 is a
 * 6rem display size and would break the layout), everything else is default.
 */
export const createPlainTheme = (accentHue?: number): Theme =>
  createTheme({
    ...(accentHue === undefined
      ? {}
      : { palette: { primary: { main: `hsl(${accentHue} 62% 42%)` } } }),
    typography: {
      h1: { fontSize: '2.125rem', fontWeight: 400 },
      h2: { fontSize: '1.25rem', fontWeight: 500 },
    },
  });

export const createThemeForMode = (mode: ThemeMode, accentHue?: number): Theme =>
  mode === 'material' ? createPlainTheme(accentHue) : createAppTheme(accentHue);

/**
 * Baseline grid of the logbook theme. The ruled-paper background repeats
 * every GRID px and every piece of text sits on a line box that is a
 * multiple of GRID, so row borders land exactly on the background rules
 * (same color) and content never drifts off the paper lines. When adding
 * UI in logbook mode, keep vertical paddings + borders summing to GRID
 * multiples.
 */
export const GRID = 24;

export const createAppTheme = (accentHue = 24): Theme => {
  const accent = `hsl(${accentHue} 62% 42%)`;
  const accentInk = `hsl(${accentHue} 70% 28%)`;
  const accentWash = `hsl(${accentHue} 55% 50% / 0.09)`;

  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: accent, dark: accentInk, contrastText: PAPER },
      background: { default: PAPER, paper: PAPER_RAISED },
      text: { primary: INK, secondary: INK_SOFT },
      divider: LINE,
      error: { main: '#a03123' },
    },
    shape: { borderRadius: 0 },
    typography: {
      fontFamily: FONT_MONO,
      body1: { fontSize: '15px', lineHeight: `${GRID}px` },
      body2: { fontSize: '0.8rem', lineHeight: `${GRID}px` },
      h1: {
        fontFamily: FONT_DISPLAY,
        fontSize: '1.7rem',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        lineHeight: `${GRID * 2}px`,
      },
      h2: {
        fontFamily: FONT_DISPLAY,
        fontSize: '1.05rem',
        fontStyle: 'italic',
        fontWeight: 700,
        lineHeight: `${GRID}px`,
        color: INK_SOFT,
      },
      overline: {
        fontSize: '0.72rem',
        letterSpacing: '0.1em',
        lineHeight: `${GRID}px`,
        color: INK_SOFT,
      },
      button: {
        fontSize: '0.78rem',
        letterSpacing: '0.14em',
        lineHeight: 'normal',
        fontWeight: 400,
      },
      caption: { fontSize: '0.72rem', lineHeight: `${GRID}px`, color: INK_SOFT },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            // One rule per 2×GRID (one ledger row), drawn on the last pixel of
            // the row so element bottom borders (same color) overlay it
            // exactly. A GRID-sized pitch would put a rule mid-row, striking
            // through the text like a completed task.
            background: `linear-gradient(${LINE} 1px, transparent 1px) 0 -1px / 100% ${GRID * 2}px, ${PAPER}`,
          },
          '@keyframes settle': {
            from: { opacity: 0, transform: 'translateY(0.5rem)' },
            to: { opacity: 1, transform: 'none' },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: true },
        styleOverrides: {
          contained: {
            backgroundColor: INK,
            color: PAPER,
            padding: '0.75rem 1.3rem',
            '&:hover': { backgroundColor: accentInk },
            '&.Mui-disabled': { backgroundColor: INK, color: PAPER, opacity: 0.4 },
          },
          text: {
            color: INK_SOFT,
            letterSpacing: '0.08em',
            padding: 0,
            minWidth: 0,
            borderBottom: `1px dashed ${LINE_STRONG}`,
            borderRadius: 0,
            '&:hover': { background: 'none', color: '#a03123', borderBottomColor: '#a03123' },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 0, height: 'auto' },
          label: { padding: '0.05rem 0.5rem', lineHeight: 1.55 },
          outlined: {
            borderColor: accentInk,
            color: accentInk,
            backgroundColor: accentWash,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontSize: '0.72rem',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          // Cards (login, tenant picker): heavy offset shadow.
          outlined: {
            border: `1.5px solid ${LINE_STRONG}`,
            boxShadow: `0.5rem 0.5rem 0 ${accentWash}, 0.5rem 0.5rem 0 1.5px ${LINE}`,
            '&[role="alert"]': {
              '& .MuiTypography-h1': { fontSize: '1.6rem' },
              '& .MuiTypography-body2': { wordBreak: 'break-word' },
            },
          },
          // Inline surfaces (add-todo form): lighter offset shadow. Whole-pixel
          // border so the height stays on the grid at every devicePixelRatio.
          elevation: {
            border: `1px solid ${LINE_STRONG}`,
            boxShadow: `0.35rem 0.35rem 0 ${accentWash}`,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: PAPER,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: LINE_STRONG, borderWidth: 1 },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: accent,
              borderWidth: 2,
            },
          },
          // +1px compensates the border, which sits in the layout flow in the
          // original but is an absolutely-positioned fieldset in MUI.
          input: { padding: 'calc(0.6rem + 1px) 0.7rem', fontSize: '15px', lineHeight: 1.55 },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            lineHeight: 1.55,
            color: INK_SOFT,
            marginBottom: '0.3rem',
            '&.Mui-focused': { color: INK_SOFT },
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: '15px', lineHeight: `${GRID}px` },
          input: {
            // MUI pins inputs to 1.4375em; snap them to the baseline grid.
            height: `${GRID}px`,
            '&::placeholder': { color: INK_SOFT, fontStyle: 'italic', opacity: 1 },
          },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'none' },
        styleOverrides: {
          root: {
            color: INK,
            borderBottom: `1px dashed ${LINE_STRONG}`,
            paddingBottom: 1,
            '&[aria-current="true"]': {
              color: accentInk,
              fontWeight: 700,
              borderBottom: `2px solid ${accent}`,
            },
            '&:hover': { color: accentInk, borderBottomColor: accentInk },
          },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            alignItems: 'baseline',
            gap: '0.9rem',
            borderBottom: `1px solid ${LINE}`,
            // 12 + 25 (baseline-aligned mixed font sizes overflow the 24px
            // line box by 1) + 10 + 1 (border) = 2×GRID; wrapped title lines
            // add exactly one GRID each, so borders always meet a paper rule.
            paddingTop: '12px',
            paddingBottom: '10px',
            // Opaque rows: a wrapped (multi-line) entry shifts the page rules
            // by one GRID below it; rows paint over them and draw their own
            // line via the bottom border, so entries never get struck through.
            backgroundColor: PAPER,
            '&:hover': { backgroundImage: `linear-gradient(${accentWash}, ${accentWash})` },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: { '&:hover': { backgroundColor: accentWash } },
        },
      },
      MuiAlert: {
        defaultProps: { severity: 'error', icon: false, variant: 'standard' },
        styleOverrides: {
          root: {
            background: 'none',
            color: '#a03123',
            padding: 0,
            fontSize: '0.8rem',
            lineHeight: 1.55,
          },
        },
      },
      MuiDivider: {
        styleOverrides: { root: { borderColor: LINE } },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            fontFamily: FONT_MONO,
            fontSize: '0.72rem',
            letterSpacing: '0.1em',
            padding: '0.2rem 0.7rem',
            color: INK_SOFT,
            borderColor: LINE_STRONG,
            backgroundColor: PAPER_RAISED,
            '&:hover': { backgroundColor: accentWash },
            '&.Mui-selected': {
              backgroundColor: INK,
              color: PAPER,
              '&:hover': { backgroundColor: INK },
            },
          },
        },
      },
    },
  });
};

type AsElement = { component?: ElementType };

export const CardTitle = styled(Typography)({ fontSize: '1.6rem' });

// Bold tenant name inside a ListItemText primary slot: the weight is a
// typography decision, so it lives here in theme.ts rather than an inline sx.
export const TenantName = styled('span')({ fontWeight: 700 });

export const Wordmark = styled(CardTitle)({ letterSpacing: 'normal' });

export const Eyebrow = styled(Typography)<AsElement>({ fontSize: '0.78rem' });

export const HeaderMeta = styled(Eyebrow)({ letterSpacing: '0.09em' });

export const HeaderMetaBreak = styled(HeaderMeta)({ wordBreak: 'break-all' });

export const FinePrint = styled(Typography)<AsElement>({ fontSize: '0.75rem' });

export const EntryIndex = styled(Typography)(({ theme }) => ({
  fontSize: '0.78rem',
  color: theme.palette.primary.dark,
}));

export const EntryDate = styled(Typography)<AsElement & { dateTime?: string }>({
  whiteSpace: 'nowrap',
});

export const DemoValue = styled('code')(({ theme }) => ({ color: theme.palette.primary.dark }));

export const LedgerHeader = styled(Box)<AsElement>({ borderBottom: `3px double ${LINE_STRONG}` });

export const TenantSwatch = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.primary.main,
  boxShadow: `0.3rem 0.3rem 0 ${alpha(theme.palette.primary.main, 0.09)}`,
}));

export const LedgerNav = styled(Stack)<AsElement>({ borderBottom: `1px solid ${LINE}` });
