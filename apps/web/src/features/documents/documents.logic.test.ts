import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';

import {
  filesByRole,
  formatFileSize,
  suggestDocumentDate,
  tagFolders,
  toDocumentFilter,
  toDocumentInput,
  uniqueDocumentTags,
  uploadErrorMessage,
  yearFolders,
} from './documents.logic.js';

describe('document view logic', () => {
  it('normalizes form values and comma-separated tags', () => {
    expect(
      toDocumentInput({
        title: '  Uchwała ',
        docType: 'uchwala',
        documentDate: '2026-07-18',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        person: '  Anna ',
        tags: 'zarząd, ważne, ',
      }),
    ).toEqual({
      title: 'Uchwała',
      docType: 'uchwala',
      documentDate: '2026-07-18',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      person: 'Anna',
      tags: ['zarząd', 'ważne'],
    });
    expect(
      toDocumentInput({
        title: 'Notatka',
        docType: 'inny',
        documentDate: '2026-07-18',
        periodStart: '',
        periodEnd: '',
        person: ' ',
        tags: '',
      }),
    ).toEqual({
      title: 'Notatka',
      docType: 'inny',
      documentDate: '2026-07-18',
      periodStart: null,
      periodEnd: null,
      tags: [],
    });
  });

  it('suggests a signing date from period fields without overwriting user input', () => {
    const base = {
      title: '',
      docType: 'umowa-uod' as const,
      documentDate: '',
      periodStart: '',
      periodEnd: '',
      person: '',
      tags: '',
    };
    expect(suggestDocumentDate(base, 'periodStart', '2026-07-01').documentDate).toBe(
      '2026-07-01',
    );
    expect(
      suggestDocumentDate(
        { ...base, docType: 'protokol' },
        'periodEnd',
        '2026-07-31',
      ).documentDate,
    ).toBe('2026-07-31');
    expect(
      suggestDocumentDate(
        { ...base, documentDate: '2026-06-30' },
        'periodStart',
        '2026-07-01',
      ).documentDate,
    ).toBe('2026-06-30');
  });

  it('omits blank filters and groups files by role', () => {
    expect(
      toDocumentFilter({
        text: ' umowa ',
        docType: '',
        person: ' ',
        tag: '',
        dateFrom: '',
        dateTo: '2026-12-31',
      }),
    ).toEqual({ text: 'umowa', dateTo: '2026-12-31' });
    expect(
      toDocumentFilter({
        text: '',
        docType: 'uchwala',
        person: 'Anna',
        tag: ' ważne ',
        dateFrom: '2026-01-01',
        dateTo: '',
      }),
    ).toEqual({
      docType: 'uchwala',
      person: 'Anna',
      tag: 'ważne',
      dateFrom: '2026-01-01',
    });
    const file = {
      id: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      role: 'source' as const,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'key',
      createdAt: '2026-07-18T00:00:00.000Z',
    };
    expect(filesByRole([file])).toMatchObject({ source: [file], other: [] });
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatFileSize(10)).toBe('10 B');
  });

  it('builds folder counts from tags and covered years', () => {
    const documents = [
      {
        tags: ['ważne', 'podpis'],
        documentDate: '2026-07-18',
        periodStart: '2025-12-01',
        periodEnd: '2026-01-15',
      },
      {
        tags: ['ważne'],
        documentDate: '2027-03-01',
        periodStart: null,
        periodEnd: null,
      },
    ];

    expect(uniqueDocumentTags(documents)).toEqual(['podpis', 'ważne']);
    expect(tagFolders(documents)).toEqual([
      { label: 'podpis', count: 1 },
      { label: 'ważne', count: 2 },
    ]);
    expect(yearFolders(documents)).toEqual([
      { label: '2027', count: 1 },
      { label: '2026', count: 1 },
      { label: '2025', count: 1 },
    ]);
  });

  it('maps API errors to Polish upload messages', () => {
    expect(
      uploadErrorMessage(
        new ApiError({ code: 'forbidden', message: 'Not allowed' }),
      ),
    ).toBe('Nie masz uprawnień do wgrania tego pliku.');
    expect(
      uploadErrorMessage(
        new ApiError({ code: 'unavailable', message: 'Storage unavailable' }),
      ),
    ).toBe('Magazyn plików jest chwilowo niedostępny.');
    expect(uploadErrorMessage(new Error('Błąd pliku'))).toBe('Błąd pliku');
    expect(uploadErrorMessage('unknown')).toBe('Nie udało się wgrać pliku.');
  });
});
