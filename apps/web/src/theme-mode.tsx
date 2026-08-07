import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material';

import { createThemeForMode, type ThemeMode } from './theme.js';

const STORAGE_KEY = 'agentproofarch-theme-mode';

const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({
  mode: 'logbook',
  setMode: () => undefined,
});

export const useThemeMode = () => useContext(ThemeModeContext);

const loadMode = (): ThemeMode => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'material' ? 'material' : 'logbook';
  } catch {
    return 'logbook';
  }
};

/** Holds the theme choice (persisted) and provides the root ThemeProvider. */
export const ThemeModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>(loadMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // private mode etc. — the choice just won't persist
    }
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);
  const theme = useMemo(() => createThemeForMode(mode), [mode]);

  return (
    <ThemeModeContext value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ThemeModeContext>
  );
};
