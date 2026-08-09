import { describe, expect, it } from 'vitest';

import {
  documentCoveredYears,
  documentDateInterval,
  documentOverlapsDateRange,
} from './document-date-logic.js';

describe('document date logic', () => {
  it('derives the effective interval from period fields or signing date', () => {
    expect(
      documentDateInterval({
        documentDate: '2026-07-18',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      }),
    ).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(documentDateInterval({ documentDate: '2026-07-18' })).toEqual({
      start: '2026-07-18',
      end: '2026-07-18',
    });
  });

  it('matches documents whose effective interval overlaps the filter range', () => {
    const document = {
      documentDate: '2026-07-18',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    };

    expect(documentOverlapsDateRange(document, { dateFrom: '2026-07-15' })).toBe(true);
    expect(documentOverlapsDateRange(document, { dateTo: '2026-07-15' })).toBe(true);
    expect(
      documentOverlapsDateRange(document, {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      }),
    ).toBe(false);
  });

  it('derives every covered year inclusively', () => {
    expect(
      documentCoveredYears({
        documentDate: '2026-07-18',
        periodStart: '2025-12-01',
        periodEnd: '2027-01-15',
      }),
    ).toEqual([2025, 2026, 2027]);
    expect(documentCoveredYears({ documentDate: '2026-07-18' })).toEqual([2026]);
  });
});
