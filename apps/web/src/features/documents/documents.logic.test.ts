import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';

import {
  filesByRole,
  formatFileSize,
  toDocumentFilter,
  toDocumentInput,
  uploadErrorMessage,
} from './documents.logic.js';

describe('document view logic', () => {
  it('normalizes form values and comma-separated tags', () => {
    expect(
      toDocumentInput({
        title: '  Uchwała ',
        docType: 'uchwala',
        documentDate: '2026-07-18',
        person: '  Anna ',
        tags: 'zarząd, ważne, ',
      }),
    ).toEqual({
      title: 'Uchwała',
      docType: 'uchwala',
      documentDate: '2026-07-18',
      person: 'Anna',
      tags: ['zarząd', 'ważne'],
    });
    expect(
      toDocumentInput({
        title: 'Notatka',
        docType: 'inny',
        documentDate: '2026-07-18',
        person: ' ',
        tags: '',
      }),
    ).toEqual({
      title: 'Notatka',
      docType: 'inny',
      documentDate: '2026-07-18',
      tags: [],
    });
  });

  it('omits blank filters and groups files by role', () => {
    expect(
      toDocumentFilter({ text: ' umowa ', docType: '', person: ' ', dateFrom: '', dateTo: '2026-12-31' }),
    ).toEqual({ text: 'umowa', dateTo: '2026-12-31' });
    expect(
      toDocumentFilter({
        text: '',
        docType: 'uchwala',
        person: 'Anna',
        dateFrom: '2026-01-01',
        dateTo: '',
      }),
    ).toEqual({ docType: 'uchwala', person: 'Anna', dateFrom: '2026-01-01' });
    const file = {
      id: 'f1',
      documentId: 'd1',
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

  it('maps API Results to Polish upload messages', () => {
    expect(uploadErrorMessage(new ApiError({ code: 'forbidden', message: 'Not allowed' }))).toBe(
      'Nie masz uprawnień do wgrania tego pliku.',
    );
    expect(uploadErrorMessage(new Error('Błąd pliku'))).toBe('Błąd pliku');
    expect(uploadErrorMessage('unknown')).toBe('Nie udało się wgrać pliku.');
  });
});
