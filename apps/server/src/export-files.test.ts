import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Document, DocumentFile } from '#core/domain/index.js';

import { archiveEntries, singleExportFileName, zipResponseStream } from './export-files.js';

const document: Document = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-1',
  title: 'Łódź — Uchwała!',
  docType: 'uchwala',
  documentDate: '2026-07-18',
  periodStart: null,
  periodEnd: null,
  person: null,
  tags: [],
  draft: false,
  signatureNotRequired: false,
  createdAt: '2026-07-18T10:00:00.000Z',
  updatedAt: '2026-07-18T10:00:00.000Z',
  deletedAt: null,
};

const file: DocumentFile = {
  id: '22222222-2222-4222-8222-222222222222',
  documentId: document.id,
  role: 'signed-scan',
  fileName: 'Skan finalny.JPG',
  contentType: 'image/jpeg',
  sizeBytes: 3,
  storageKey: 'key',
  createdAt: '2026-07-18T10:00:00.000Z',
};

describe('export files', () => {
  it('slugifies Polish titles and preserves a safe extension', () => {
    expect(singleExportFileName(document, file)).toBe(
      '2026-07-18--lodz-uchwala--signed-scan.jpg',
    );
  });

  it('keeps duplicate archive entries distinct and emits a readable ZIP', async () => {
    const entries = await archiveEntries([
      {
        document,
        files: [
          { file, bytes: new Uint8Array([1]) },
          {
            file: { ...file, id: '33333333-3333-4333-8333-333333333333' },
            bytes: new Uint8Array([2]),
          },
        ],
      },
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      '2026-07-18--lodz-uchwala/signed-scan--skan-finalny.jpg',
      '2026-07-18--lodz-uchwala/signed-scan--skan-finalny--2.jpg',
    ]);
    const zipped = new Uint8Array(await new Response(zipResponseStream(entries)).arrayBuffer());
    expect(Object.keys(unzipSync(zipped))).toEqual(entries.map((entry) => entry.name));
  });

  it('supplies safe fallbacks when titles and file extensions carry no usable name', async () => {
    const oddDocument = { ...document, title: '---' };
    const extensionless = {
      ...file,
      fileName: '---',
      contentType: 'application/pdf',
    };
    expect(singleExportFileName(oddDocument, extensionless)).toBe(
      '2026-07-18--dokument--signed-scan.pdf',
    );
    const entries = await archiveEntries([
      {
        document: oddDocument,
        files: [
          {
            file: { ...extensionless, contentType: 'image/png' },
            bytes: new Uint8Array([1]),
          },
        ],
      },
    ]);
    expect(entries[0]?.name).toBe('2026-07-18--dokument/signed-scan--plik.bin');
  });
});
