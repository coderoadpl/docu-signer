import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  PolishDatePicker,
  PolishDatePickerProvider,
  polishPickerLocaleText,
} from './PolishDatePicker.js';

describe('PolishDatePicker', () => {
  it('keeps the date-picker action labels in Polish', () => {
    expect(polishPickerLocaleText.openDatePickerDialogue(null)).toBe('Wybierz datę');
    expect(polishPickerLocaleText.openDatePickerDialogue('01.07.2026')).toBe(
      'Wybierz datę, obecnie wybrana data to 01.07.2026',
    );
    expect(polishPickerLocaleText.fieldClearLabel).toBe('Wyczyść');
  });

  it('renders an empty Polish date field with minimal props', () => {
    render(
      <PolishDatePickerProvider>
        <PolishDatePicker label="Od" value="" onChange={() => undefined} />
      </PolishDatePickerProvider>,
    );

    expect(screen.getByRole('group', { name: /^Od/u })).toHaveTextContent('DD.MM.YYYY');
  });

  it('wires helper text, refs and clear actions through the localized picker', () => {
    const inputRef = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(
      <PolishDatePickerProvider>
        <PolishDatePicker
          id="document-date"
          label="Data podpisania"
          value="2026-07-01"
          onChange={onChange}
          required
          error
          helperText="Data podpisania jest wymagana"
          inputRef={inputRef}
          describedBy="document-date-helper-text"
          sx={{ flex: 1 }}
        />
      </PolishDatePickerProvider>,
    );

    const field = screen.getByRole('group', { name: /^Data podpisania/u });
    expect(field).toHaveAccessibleDescription('Data podpisania jest wymagana');
    expect(field).toHaveTextContent('01.07.2026');
    expect(screen.getByText('Data podpisania jest wymagana')).toHaveAttribute(
      'id',
      'document-date-helper-text',
    );
    expect(inputRef.current?.id).toBe('document-date');

    fireEvent.click(within(field).getByRole('button', { name: 'Wyczyść' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});
