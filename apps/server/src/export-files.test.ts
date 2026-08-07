import { describe, expect, it } from 'vitest';

import type { Document, DocumentFile } from '#core/domain/index.js';

import { archiveEntries, singleExportFileName } from './export-files.js';

const document: Document = {
  id: 'document-1',
  tenantId: 'tenant-1',
  title: 'Łódź — Uchwała!',
  docType: 'uchwala',
  documentDate: '2026-07-18',
  tags: [],
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
};

const file: DocumentFile = {
  id: 'file-1',
  documentId: document.id,
  role: 'signed-scan',
  fileName: 'Skan finalny.JPG',
  contentType: 'image/jpeg',
  sizeBytes: 3,
  storageKey: 'key',
  createdAt: '2026-07-18T10:00:00.000Z',
};

describe('export file names', () => {
  it('slugifies Polish titles and preserves a safe extension', () => {
    expect(singleExportFileName(document, file)).toBe(
      '2026-07-18--lodz-uchwala--signed-scan.jpg',
    );
  });

  it('keeps duplicate archive entries distinct', async () => {
    const entries = await archiveEntries([
      {
        document,
        files: [
          { file, bytes: new Uint8Array([1]) },
          { file: { ...file, id: 'file-2' }, bytes: new Uint8Array([2]) },
        ],
      },
    ]);

    expect(entries.map((entry) => entry.name)).toEqual([
      '2026-07-18--lodz-uchwala/signed-scan--skan-finalny.jpg',
      '2026-07-18--lodz-uchwala/signed-scan--skan-finalny--2.jpg',
    ]);
  });
});
