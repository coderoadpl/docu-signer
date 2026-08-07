import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeModeProvider, useThemeMode } from './theme-mode.js';

const STORAGE_KEY = 'agentproofarch-theme-mode';

interface FakeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const memoryStorage = (): FakeStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
};

const install = (storage: FakeStorage) => vi.stubGlobal('localStorage', storage);

const Probe = () => {
  const { mode, setMode } = useThemeMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button type="button" onClick={() => setMode('material')}>
        to material
      </button>
    </div>
  );
};

const renderInProvider = () =>
  render(
    <ThemeModeProvider>
      <Probe />
    </ThemeModeProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('ThemeModeProvider', () => {
  it('defaults to logbook and persists that choice', () => {
    const storage = memoryStorage();
    install(storage);

    renderInProvider();

    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');
    expect(storage.getItem(STORAGE_KEY)).toBe('logbook');
  });

  it('restores a persisted material choice', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, 'material');
    install(storage);

    renderInProvider();

    expect(screen.getByTestId('mode')).toHaveTextContent('material');
  });

  it('persists a mode change through the context setter', async () => {
    const storage = memoryStorage();
    install(storage);

    renderInProvider();
    await userEvent.click(screen.getByRole('button', { name: 'to material' }));

    expect(screen.getByTestId('mode')).toHaveTextContent('material');
    expect(storage.getItem(STORAGE_KEY)).toBe('material');
  });

  it('falls back to logbook when reading storage throws', () => {
    install({
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => undefined,
    });

    renderInProvider();

    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');
  });

  it('keeps working when writing storage throws', () => {
    install({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage blocked');
      },
    });

    expect(() => renderInProvider()).not.toThrow();
    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');
  });
});

describe('useThemeMode', () => {
  it('exposes an inert default outside a provider', async () => {
    install(memoryStorage());

    render(<Probe />);
    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');

    await userEvent.click(screen.getByRole('button', { name: 'to material' }));

    expect(screen.getByTestId('mode')).toHaveTextContent('logbook');
  });
});
