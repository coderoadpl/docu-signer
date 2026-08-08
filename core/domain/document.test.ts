import { describe, expect, it } from 'vitest';

import {
  createDocumentSchema,
  documentFileSchema,
  documentListFilterSchema,
  documentSchema,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
} from './document.js';

describe('document schemas', () => {
  it('parses documents and files', () => {
    expect(
      documentSchema.parse({
        id: 'doc-1',
        tenantId: 'tenant-1',
        title: 'Agreement',
        docType: 'umowa-uod',
        documentDate: '2026-07-18',
        tags: [],
        createdAt: '2026-07-18T10:00:00.000Z',
        updatedAt: '2026-07-18T10:00:00.000Z',
      }),
    ).toMatchObject({ id: 'doc-1' });
    expect(
      documentFileSchema.parse({
        id: 'file-1',
        documentId: 'doc-1',
        role: 'signed-digital',
        fileName: 'signed.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        storageKey: 'key',
        createdAt: '2026-07-18T10:00:00.000Z',
      }),
    ).toMatchObject({ id: 'file-1' });
  });

  it('defaults tags and rejects invalid dates, types, titles, and ranges', () => {
    expect(
      createDocumentSchema.parse({
        title: ' Agreement ',
        docType: 'inny',
        documentDate: '2026-07-18',
      }),
    ).toEqual({ title: 'Agreement', docType: 'inny', documentDate: '2026-07-18', tags: [] });
    expect(createDocumentSchema.safeParse({ title: '', docType: 'other', documentDate: '2026-02-30' }).success).toBe(false);
    expect(documentListFilterSchema.safeParse({ dateFrom: '2026-07-19', dateTo: '2026-07-18' }).success).toBe(false);
  });

  it('accepts only PDF and image upload content types', () => {
    expect(
      fileUploadRequestSchema.safeParse({
        fileName: 'scan.png',
        contentType: 'image/png',
        role: 'signed-scan',
      }).success,
    ).toBe(true);
    expect(
      fileUploadRequestSchema.safeParse({
        fileName: 'notes.txt',
        contentType: 'text/plain',
        role: 'other',
      }).success,
    ).toBe(false);
    expect(
      finalizeFileUploadSchema.safeParse({
        key: 'key',
        fileName: 'page.html',
        contentType: 'text/html',
        sizeBytes: 10,
        role: 'source',
      }).success,
    ).toBe(false);
  });
});
