import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeModeProvider, useThemeMode } from '../../theme-mode.js';
import { ThemeSwitcher } from './ThemeSwitcher.js';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

const Mode = () => <span data-testid="mode">{useThemeMode().mode}</span>;

const setup = () =>
  render(
    <ThemeModeProvider>
      <ThemeSwitcher />
      <Mode />
    </ThemeModeProvider>,
  );

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('ThemeSwitcher', () => {
  it('switches to material and back to logbook', async () => {
    setup();
    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');

    await userEvent.click(screen.getByRole('button', { name: 'material' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('material');

    await userEvent.click(screen.getByRole('button', { name: 'logbook' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');
  });

  it('ignores a toggle that would deselect the active mode', async () => {
    setup();

    await userEvent.click(screen.getByRole('button', { name: 'material' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('material');

    // Re-clicking the selected toggle fires onChange(null); the guard keeps the mode.
    await userEvent.click(screen.getByRole('button', { name: 'material' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('material');
  });
});
