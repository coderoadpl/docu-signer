import { describe, expect, it } from 'vitest';

import {
  createDocumentSchema,
  createSavedSearchSchema,
  documentListFilterSchema,
  exportDocumentsSchema,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
  moveDocumentFileSchema,
} from './document.js';

describe('document schemas', () => {
  it('normalizes entry input and applies empty tags', () => {
    expect(
      createDocumentSchema.parse({
        title: '  Agreement  ',
        docType: 'umowa-uod',
        documentDate: '2026-07-27',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-31',
      }),
    ).toEqual({
      title: 'Agreement',
      docType: 'umowa-uod',
      documentDate: '2026-07-27',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      tags: [],
    });
  });

  it('normalizes saved searches around the document filter schema', () => {
    expect(
      createSavedSearchSchema.parse({
        name: '  Anna protokoły  ',
        filter: {
          text: ' protokół ',
          docType: 'protokol',
          person: ' Anna ',
          tag: ' odbiór ',
          dateFrom: '2026-01-01',
          signatureStatus: 'signed',
        },
      }),
    ).toEqual({
      name: 'Anna protokoły',
      filter: {
        text: 'protokół',
        docType: 'protokol',
        person: 'Anna',
        tag: 'odbiór',
        dateFrom: '2026-01-01',
        signatureStatus: 'signed',
      },
    });
    expect(createSavedSearchSchema.safeParse({ name: '', filter: {} }).success).toBe(false);
    expect(
      createSavedSearchSchema.safeParse({
        name: 'Odwrócone daty',
        filter: { dateFrom: '2026-02-01', dateTo: '2026-01-01' },
      }).success,
    ).toBe(false);
    expect(
      createSavedSearchSchema.safeParse({
        name: 'Błędny status',
        filter: { signatureStatus: 'unknown' },
      }).success,
    ).toBe(false);
  });

  it('rejects inverted dates, inverted periods, unsafe MIME types, oversized files, and bulk overflow', () => {
    expect(
      documentListFilterSchema.safeParse({
        dateFrom: '2026-07-28',
        dateTo: '2026-07-27',
      }).success,
    ).toBe(false);
    expect(
      createDocumentSchema.safeParse({
        title: 'Agreement',
        docType: 'umowa-uod',
        documentDate: '2026-07-27',
        periodStart: '2026-08-01',
        periodEnd: '2026-07-31',
      }).success,
    ).toBe(false);
    expect(
      moveDocumentFileSchema.safeParse({
        title: 'Moved',
        docType: 'protokol',
        periodStart: '2026-08-01',
        periodEnd: '2026-07-31',
      }).success,
    ).toBe(false);
    expect(
      fileUploadRequestSchema.safeParse({
        fileName: 'payload.exe',
        contentType: 'application/octet-stream',
        role: 'other',
      }).success,
    ).toBe(false);
    expect(
      finalizeFileUploadSchema.safeParse({
        key: 'key',
        fileName: 'scan.pdf',
        contentType: 'application/pdf',
        sizeBytes: 25 * 1024 * 1024 + 1,
        role: 'source',
      }).success,
    ).toBe(false);
    const bulkExport = exportDocumentsSchema.safeParse({
      documentIds: Array.from(
        { length: 101 },
        (_, index) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      ),
    });
    expect(bulkExport.success).toBe(false);
    if (!bulkExport.success) {
      expect(bulkExport.error.issues[0]?.message).toBe(
        'An export may contain at most 100 documents',
      );
    }
  });
});
