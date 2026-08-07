import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';

import { useThemeMode } from '../../theme-mode.js';

/** Top-of-page switch between the logbook theme and stock Material UI. */
export const ThemeSwitcher = () => {
  const { mode, setMode } = useThemeMode();
  return (
    <Box sx={{ position: 'fixed', top: 10, right: 12, zIndex: (t) => t.zIndex.appBar }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={mode}
        onChange={(_event, value) => {
          if (value === 'logbook' || value === 'material') setMode(value);
        }}
        aria-label="theme"
      >
        <ToggleButton value="logbook">logbook</ToggleButton>
        <ToggleButton value="material">material</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};
