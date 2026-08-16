import { describe, expect, it } from 'vitest';

import { formatPolishDate, formatPolishDateTime } from './format-date.js';

describe('formatPolishDate', () => {
  it('formats date-only and timestamp values as DD.MM.YYYY', () => {
    expect(formatPolishDate('2026-07-09')).toBe('09.07.2026');
    expect(formatPolishDate('2026-01-02T10:00:00.000Z')).toBe('02.01.2026');
  });

  it('preserves an invalid value', () => {
    expect(formatPolishDate('nieznana data')).toBe('nieznana data');
  });

  it('formats a valid non-ISO date value', () => {
    const value = new Date(2026, 0, 2, 12).toString();

    expect(formatPolishDate(value)).toBe('02.01.2026');
  });

  it('formats timestamps with local date and time', () => {
    const value = new Date(2026, 7, 16, 14, 5).toISOString();

    expect(formatPolishDateTime(value)).toBe('16.08.2026 14:05');
    expect(formatPolishDateTime('nieznana data')).toBe('nieznana data');
  });
});
