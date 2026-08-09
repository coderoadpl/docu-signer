import { describe, expect, it } from 'vitest';

import { polishPickerLocaleText } from './polish-picker-locale.js';

describe('polishPickerLocaleText', () => {
  it('names the date picker and clear actions in Polish', () => {
    expect(polishPickerLocaleText.openDatePickerDialogue(null)).toBe('Wybierz datę');
    expect(polishPickerLocaleText.openDatePickerDialogue('01.07.2026')).toBe(
      'Wybierz datę, obecnie wybrana data to 01.07.2026',
    );
    expect(polishPickerLocaleText.fieldClearLabel).toBe('Wyczyść');
  });
});
