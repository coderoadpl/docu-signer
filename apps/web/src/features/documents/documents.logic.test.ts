import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';

import {
  documentFilterSummary,
  emptyDocumentFilters,
  filesByRole,
  fileNameStem,
  formatFileSize,
  hasDocumentFilter,
  suggestDocumentDate,
  toDocumentFilter,
  toDocumentFilterValues,
  toDocumentInput,
  uniqueDocumentPersons,
  uniqueDocumentTags,
  uploadErrorMessage,
} from './documents.logic.js';

describe('document view logic', () => {
  it('normalizes form values and tag chips', () => {
    expect(
      toDocumentInput({
        title: '  Uchwała ',
        docType: 'uchwala',
        documentDate: '2026-07-18',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
        person: '  Anna ',
        tags: ['zarząd', ' ważne ', 'zarząd', ''],
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
        tags: [],
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
      tags: [],
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
    expect(emptyDocumentFilters()).toEqual({
      text: '',
      docType: '',
      person: '',
      tag: '',
      dateFrom: '',
      dateTo: '',
      signatureStatus: '',
    });
    expect(
      toDocumentFilter({
        text: ' umowa ',
        docType: '',
        person: ' ',
        tag: '',
        dateFrom: '',
        dateTo: '2026-12-31',
        signatureStatus: '',
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
        signatureStatus: 'needs-signature',
      }),
    ).toEqual({
      docType: 'uchwala',
      person: 'Anna',
      tag: 'ważne',
      dateFrom: '2026-01-01',
      signatureStatus: 'needs-signature',
    });
    expect(hasDocumentFilter({})).toBe(false);
    expect(hasDocumentFilter({ tag: 'ważne', signatureStatus: 'signed' })).toBe(true);
    expect(toDocumentFilterValues({ text: 'umowa', tag: 'ważne', signatureStatus: 'signed' })).toEqual({
      text: 'umowa',
      docType: '',
      person: '',
      tag: 'ważne',
      dateFrom: '',
      dateTo: '',
      signatureStatus: 'signed',
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

  it('builds tag suggestions and saved-search summaries', () => {
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
    expect(
      uniqueDocumentPersons([
        { person: 'Anna Nowak' },
        { person: ' Jan Kowalski ' },
        { person: 'Anna Nowak' },
        { person: null },
      ]),
    ).toEqual(['Anna Nowak', 'Jan Kowalski']);
    expect(
      documentFilterSummary({
        text: 'umowa',
        docType: 'umowa-uod',
        person: 'Anna',
        tag: 'ważne',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        signatureStatus: 'needs-signature',
      }),
    ).toBe(
      'Tytuł: umowa · Typ: Umowa UoD · Osoba: Anna · Tag: ważne · Od: 01.01.2026 · Do: 31.12.2026 · Status podpisu: Do podpisania',
    );
    expect(documentFilterSummary({})).toBe('Wszystkie dokumenty');
  });

  it('derives file name stems', () => {
    expect(fileNameStem('umowa.pdf')).toBe('umowa');
    expect(fileNameStem('.env')).toBe('.env');
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
