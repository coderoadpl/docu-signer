import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { createAppTheme, createPlainTheme, createThemeForMode } from './theme.js';

describe('createPlainTheme', () => {
  it('carries the tenant accent as the primary color', () => {
    expect(createPlainTheme(120).palette.primary.main).toBe('hsl(120 62% 42%)');
  });

  it('keeps the MUI default primary when no accent is provided', () => {
    expect(createPlainTheme().palette.primary.main).toBe(createTheme().palette.primary.main);
  });

  it('scales the display heading down from the raw MUI default', () => {
    expect(createPlainTheme().typography.h1.fontSize).toBe('2.125rem');
  });
});

describe('createThemeForMode', () => {
  it('returns the stock Material theme in material mode', () => {
    const theme = createThemeForMode('material', 200);

    expect(theme.palette.primary.main).toBe('hsl(200 62% 42%)');
    expect(theme.shape.borderRadius).toBe(4);
  });

  it('returns the logbook theme in logbook mode', () => {
    const theme = createThemeForMode('logbook', 200);

    expect(theme.palette.primary.main).toBe('hsl(200 62% 42%)');
    expect(theme.shape.borderRadius).toBe(0);
  });
});

describe('createAppTheme', () => {
  it('defaults to the warm accent hue and paper palette', () => {
    const theme = createAppTheme();

    expect(theme.palette.primary.main).toBe('hsl(24 62% 42%)');
    expect(theme.palette.background.default).toBe('#f6f2ea');
  });
});
