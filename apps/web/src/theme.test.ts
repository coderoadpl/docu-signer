import { getContrastRatio } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { createAppTheme, DEFAULT_PRIMARY } from './theme.js';

describe('createAppTheme', () => {
  it('carries the tenant accent as the primary color', () => {
    expect(createAppTheme({ accentHue: 120 }).palette.primary.main).toBe('hsl(120, 62%, 36%)');
  });

  it('uses the calm ink default primary when no accent is provided', () => {
    expect(createAppTheme().palette.primary.main).toBe(DEFAULT_PRIMARY);
  });

  it('picks contrast text meeting WCAG AA for any accent hue', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      const { main, contrastText } = createAppTheme({ accentHue: hue }).palette.primary;
      expect(getContrastRatio(main, contrastText)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets WCAG AA for the default primary and body text', () => {
    const { palette } = createAppTheme();

    expect(
      getContrastRatio(palette.primary.main, palette.primary.contrastText),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(palette.text.primary, palette.background.default),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      getContrastRatio(palette.text.secondary, palette.background.paper),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('softens the shape and scales down display headings', () => {
    const theme = createAppTheme();

    expect(theme.shape.borderRadius).toBe(8);
    expect(theme.typography.h1.fontSize).toBe('1.75rem');
    expect(theme.typography.button.textTransform).toBe('none');
  });

  it('turns Material motion off when reduced motion is preferred', () => {
    const theme = createAppTheme({ prefersReducedMotion: true });

    expect(theme.transitions.create('opacity')).toBe('none');
    expect(theme.transitions.duration.enteringScreen).toBe(0);
    expect(theme.transitions.getAutoHeightDuration(100)).toBe(0);
    expect(theme).toMatchObject({
      components: { MuiButtonBase: { defaultProps: { disableRipple: true } } },
    });
  });
});
