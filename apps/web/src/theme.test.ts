import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { createAppTheme } from './theme.js';

describe('createAppTheme', () => {
  it('carries the tenant accent as the primary color', () => {
    expect(createAppTheme(120).palette.primary.main).toBe('hsl(120 62% 42%)');
  });

  it('keeps the MUI default primary when no accent is provided', () => {
    expect(createAppTheme().palette.primary.main).toBe(createTheme().palette.primary.main);
  });

  it('picks accessible contrast text per accent hue at the 4.5 threshold', () => {
    const purple = createAppTheme(280);
    const yellow = createAppTheme(60);

    expect(purple.palette.primary.contrastText).toBe('#fff');
    expect(yellow.palette.primary.contrastText).not.toBe('#fff');
  });

  it('uses the Material shape and scales down display headings', () => {
    const theme = createAppTheme();

    expect(theme.shape.borderRadius).toBe(4);
    expect(theme.typography.h1.fontSize).toBe('2.125rem');
  });
});
