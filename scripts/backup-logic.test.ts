import { describe, expect, it } from 'vitest';

import {
  diffManifest,
  formatArchiveName,
  inventoriesMatch,
  monthlyTransferGuard,
  parseArchiveName,
  pgEnvFromDatabaseUrl,
  renderBackupIndex,
  selectRetention,
  type BackupIndexBlob,
  type BackupIndexRow,
  type BlobInventoryItem,
  type BlobManifestItem,
} from './backup-logic.js';

const inventory = (
  pathname: string,
  etag: string,
  sizeBytes: number,
): BlobInventoryItem => ({ pathname, etag, sizeBytes });

const manifest = (
  pathname: string,
  etag: string,
  sizeBytes: number,
): BlobManifestItem => ({
  pathname,
  etag,
  sizeBytes,
  contentType: 'application/pdf',
  sha256: 'a'.repeat(64),
});

const indexRow = (
  documentId: string,
  documentTitle: string,
  pathname: string,
  fileName: string,
  role = 'source',
): BackupIndexRow => ({
  documentId,
  documentTitle,
  docType: 'umowa-uod',
  person: 'Jan Kowalski',
  role,
  fileName,
  contentType: 'application/pdf',
  sizeBytes: 1234,
  pathname,
});

const indexBlob = (pathname: string): BackupIndexBlob => ({
  pathname,
  contentType: 'application/pdf',
  sizeBytes: 1234,
});

describe('backup manifest diffing', () => {
  it('classifies new, changed, deleted, and unchanged blobs', () => {
    const result = diffManifest(
      [
        manifest('deleted.pdf', 'old', 3),
        manifest('same.pdf', 'same', 4),
        manifest('etag-changed.pdf', 'old', 5),
        manifest('size-changed.pdf', 'stable', 6),
      ],
      [
        inventory('new.pdf', 'new', 2),
        inventory('same.pdf', 'same', 4),
        inventory('etag-changed.pdf', 'new', 5),
        inventory('size-changed.pdf', 'stable', 7),
      ],
    );

    expect(result.newItems.map((item) => item.pathname)).toEqual(['new.pdf']);
    expect(result.changedItems.map((item) => item.pathname)).toEqual([
      'etag-changed.pdf',
      'size-changed.pdf',
    ]);
    expect(result.deletedItems.map((item) => item.pathname)).toEqual(['deleted.pdf']);
    expect(result.unchangedItems.map((item) => item.pathname)).toEqual(['same.pdf']);
  });

  it('compares inventory independently of listing order', () => {
    const left = [inventory('a', '1', 1), inventory('b', '2', 2)];
    expect(inventoriesMatch(left, [...left].reverse())).toBe(true);
    expect(
      inventoriesMatch(left, [inventory('a', 'changed', 1), inventory('b', '2', 2)]),
    ).toBe(false);
    expect(inventoriesMatch(left, left.slice(0, 1))).toBe(false);
  });

  it('rejects duplicate blob pathnames in an inventory', () => {
    expect(() => diffManifest([], [inventory('a', '1', 1), inventory('a', '2', 2)])).toThrow(
      'Duplicate blob pathname in inventory',
    );
  });
});

describe('backup PostgreSQL env decomposition', () => {
  it('decomposes a full Neon-style direct database URL', () => {
    expect(
      pgEnvFromDatabaseUrl(
        'postgresql://neondb_owner:secret-pass@ep-autumn-haze-a1b2c3.us-east-2.aws.neon.tech:5432/neondb?sslmode=require&channel_binding=require',
      ),
    ).toEqual({
      PGHOST: 'ep-autumn-haze-a1b2c3.us-east-2.aws.neon.tech',
      PGPORT: '5432',
      PGDATABASE: 'neondb',
      PGUSER: 'neondb_owner',
      PGPASSWORD: 'secret-pass',
      PGSSLMODE: 'require',
      PGCHANNELBINDING: 'require',
    });
  });

  it('decodes percent-encoded database credentials', () => {
    expect(
      pgEnvFromDatabaseUrl('postgresql://backup%2Buser:p%40ss%2Fword%3Aone@db.example.test/app'),
    ).toMatchObject({
      PGUSER: 'backup+user',
      PGPASSWORD: 'p@ss/word:one',
    });
  });

  it('defaults the port and omits absent optional libpq parameters', () => {
    const env = pgEnvFromDatabaseUrl('postgresql://agentproofarch:agentproofarch@localhost/app');

    expect(env).toMatchObject({
      PGHOST: 'localhost',
      PGPORT: '5432',
      PGDATABASE: 'app',
      PGUSER: 'agentproofarch',
      PGPASSWORD: 'agentproofarch',
    });
    expect(env).not.toHaveProperty('PGSSLMODE');
    expect(env).not.toHaveProperty('PGCHANNELBINDING');
  });

  it('rejects non-direct or incomplete database URLs', () => {
    for (const databaseUrl of [
      'mysql://user:pass@localhost/app',
      'postgresql://user:pass@ep-autumn-haze-pooler.us-east-2.aws.neon.tech/app',
      'postgresql://user:pass@localhost',
      'postgresql://:pass@localhost/app',
      'postgresql://user@localhost/app',
    ]) {
      expect(() => pgEnvFromDatabaseUrl(databaseUrl)).toThrow(
        'NEON_DATABASE_URL_UNPOOLED must be a direct PostgreSQL connection string',
      );
    }
  });
});

describe('backup retention', () => {
  it('keeps seven distinct daily copies plus four weekly representatives', () => {
    const names = [
      '2026-08-01T01-17-00Z',
      '2026-08-01T09-00-00Z',
      '2026-07-31T01-17-00Z',
      '2026-07-30T01-17-00Z',
      '2026-07-29T01-17-00Z',
      '2026-07-28T01-17-00Z',
      '2026-07-27T01-17-00Z',
      '2026-07-26T01-17-00Z',
      '2026-07-19T01-17-00Z',
      '2026-07-12T01-17-00Z',
      '2026-07-05T01-17-00Z',
      '2026-06-28T01-17-00Z',
    ];
    const files = names.map((timestamp, index) => ({
      id: `id-${index}`,
      name: `docu-signer-backup-${timestamp}.zip`,
    }));
    const selection = selectRetention([
      ...files,
      { id: 'unrelated', name: 'notes.zip' },
    ]);

    expect(selection.keepIds.has('id-1')).toBe(true);
    expect(selection.keepIds.has('id-0')).toBe(false);
    expect(selection.keepIds.has('id-7')).toBe(true);
    expect(selection.keepIds.has('id-8')).toBe(true);
    expect(selection.keepIds.has('id-9')).toBe(true);
    expect(selection.deleteIds.has('id-10')).toBe(true);
    expect(selection.deleteIds.has('id-11')).toBe(true);
    expect(selection.deleteIds.has('unrelated')).toBe(false);
  });

  it('uses the oldest copy in a week when no Sunday exists', () => {
    const files = [
      { id: 'new', name: 'docu-signer-backup-2026-08-08T01-17-00Z.zip' },
      { id: 'old', name: 'docu-signer-backup-2026-08-03T01-17-00Z.zip' },
    ];
    const selection = selectRetention(files);
    expect(selection.keepIds).toEqual(new Set(['new', 'old']));
  });
});

describe('monthly Blob transfer guard', () => {
  it('adds this run to the current month and allows the exact ceiling', () => {
    expect(
      monthlyTransferGuard(
        { month: '2026-08', bytesDownloaded: 3_000 },
        new Date('2026-08-15T01:17:00Z'),
        2_000,
        5_000,
      ),
    ).toEqual({
      month: '2026-08',
      priorBytes: 3_000,
      projectedBytes: 5_000,
      ceilingBytes: 5_000,
      allowed: true,
    });
  });

  it('resets at month rollover and refuses a projected overage', () => {
    expect(
      monthlyTransferGuard(
        { month: '2026-07', bytesDownloaded: 4_900 },
        new Date('2026-08-01T01:17:00Z'),
        5_001,
        5_000,
      ),
    ).toMatchObject({ priorBytes: 0, projectedBytes: 5_001, allowed: false });
  });

  it('rejects invalid transfer byte counts', () => {
    expect(() => monthlyTransferGuard(null, new Date('2026-08-01T01:17:00Z'), -1, 1)).toThrow(
      'Planned transfer must be a non-negative safe integer',
    );
    expect(() => monthlyTransferGuard(null, new Date('2026-08-01T01:17:00Z'), 1, -1)).toThrow(
      'Transfer ceiling must be a non-negative safe integer',
    );
    expect(() =>
      monthlyTransferGuard(
        { month: '2026-08', bytesDownloaded: -1 },
        new Date('2026-08-01T01:17:00Z'),
        1,
        1,
      ),
    ).toThrow('Previous transfer must be a non-negative safe integer');
    expect(() =>
      monthlyTransferGuard(
        { month: '2026-08', bytesDownloaded: Number.MAX_SAFE_INTEGER },
        new Date('2026-08-01T01:17:00Z'),
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow('Projected transfer is too large');
  });
});

describe('backup archive names', () => {
  it('round-trips the UTC timestamp format', () => {
    const date = new Date('2026-08-01T01:17:09Z');
    const name = formatArchiveName(date);
    expect(name).toBe('docu-signer-backup-2026-08-01T01-17-09Z.zip');
    expect(parseArchiveName(name)).toEqual(date);
  });

  it('rejects invalid names and impossible timestamps', () => {
    expect(parseArchiveName('backup-2026-08-01.zip')).toBeNull();
    expect(parseArchiveName('docu-signer-backup-2026-02-30T01-17-00Z.zip')).toBeNull();
    expect(parseArchiveName('docu-signer-backup-2026-08-01T25-17-00Z.zip')).toBeNull();
  });
});

describe('backup index rendering', () => {
  it('groups archived files under their documents', () => {
    expect(
      renderBackupIndex(
        [
          indexRow('doc-a', 'Umowa A', 'documents/default/doc-a/source', 'umowa-a.pdf'),
          indexRow('doc-a', 'Umowa A', 'documents/default/doc-a/signed', 'umowa-a-signed.pdf', 'signed-digital'),
        ],
        [
          indexBlob('documents/default/doc-a/source'),
          indexBlob('documents/default/doc-a/signed'),
        ],
      ),
    ).toBe(`Docu Signer backup index

DOCUMENTS

Umowa A
docType: umowa-uod
person: Jan Kowalski
- role: signed-digital
  file: umowa-a-signed.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/signed
- role: source
  file: umowa-a.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/source
`);
  });

  it('sorts documents by title', () => {
    expect(
      renderBackupIndex(
        [
          indexRow('doc-z', 'Zezwolenie', 'documents/default/doc-z/source', 'z.pdf'),
          indexRow('doc-a', 'Akt', 'documents/default/doc-a/source', 'a.pdf'),
        ],
        [
          indexBlob('documents/default/doc-z/source'),
          indexBlob('documents/default/doc-a/source'),
        ],
      ),
    ).toBe(`Docu Signer backup index

DOCUMENTS

Akt
docType: umowa-uod
person: Jan Kowalski
- role: source
  file: a.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/source

Zezwolenie
docType: umowa-uod
person: Jan Kowalski
- role: source
  file: z.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-z/source
`);
  });

  it('places blobs without database rows in the orphan section', () => {
    expect(
      renderBackupIndex(
        [indexRow('doc-a', 'Umowa A', 'documents/default/doc-a/source', 'umowa-a.pdf')],
        [
          indexBlob('documents/default/doc-a/source'),
          indexBlob('documents/default/orphan-b'),
          indexBlob('documents/default/orphan-a'),
        ],
      ),
    ).toBe(`Docu Signer backup index

DOCUMENTS

Umowa A
docType: umowa-uod
person: Jan Kowalski
- role: source
  file: umowa-a.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/source

ORPHANS
- blobs/documents/default/orphan-a
- blobs/documents/default/orphan-b
`);
  });

  it('renders only orphaned blobs when every row points outside the archive', () => {
    expect(
      renderBackupIndex(
        [indexRow('doc-a', 'Missing', 'documents/default/doc-a/missing', 'missing.pdf')],
        [indexBlob('documents/default/orphan')],
      ),
    ).toBe(`Docu Signer backup index


ORPHANS
- blobs/documents/default/orphan
`);
  });

  it('omits blank person values and preserves zero-byte file sizes', () => {
    const row = {
      ...indexRow('doc-a', '  Untitled\nDocument  ', 'documents/default/doc-a/source', ' empty.pdf '),
      docType: ' inny ',
      person: '   ',
      role: ' source ',
      contentType: ' application/pdf ',
      sizeBytes: 0,
    };

    expect(renderBackupIndex([row], [indexBlob('documents/default/doc-a/source')])).toBe(`Docu Signer backup index

DOCUMENTS

Untitled Document
docType: inny
- role: source
  file: empty.pdf
  content type: application/pdf
  size: 0 bytes
  ZIP path: blobs/documents/default/doc-a/source
`);
  });

  it('omits null person values', () => {
    const row = {
      ...indexRow('doc-a', 'Untitled', 'documents/default/doc-a/source', 'empty.pdf'),
      person: null,
    };

    expect(renderBackupIndex([row], [indexBlob('documents/default/doc-a/source')])).toBe(`Docu Signer backup index

DOCUMENTS

Untitled
docType: umowa-uod
- role: source
  file: empty.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/source
`);
  });

  it('sorts documents and files with stable tie-breakers', () => {
    expect(
      renderBackupIndex(
        [
          indexRow('doc-b', 'Same Title', 'documents/default/doc-b/z', 'same.pdf'),
          indexRow('doc-a', ' Same   Title ', 'documents/default/doc-a/a', 'same.pdf'),
          indexRow('doc-a', ' Same   Title ', 'documents/default/doc-a/b', 'same.pdf'),
          indexRow('doc-a', ' Same   Title ', 'documents/default/doc-a/c', 'other.pdf'),
        ],
        [
          indexBlob('documents/default/doc-b/z'),
          indexBlob('documents/default/doc-a/c'),
          indexBlob('documents/default/doc-a/b'),
          indexBlob('documents/default/doc-a/a'),
        ],
      ),
    ).toBe(`Docu Signer backup index

DOCUMENTS

Same Title
docType: umowa-uod
person: Jan Kowalski
- role: source
  file: other.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/c
- role: source
  file: same.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/a
- role: source
  file: same.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-a/b

Same Title
docType: umowa-uod
person: Jan Kowalski
- role: source
  file: same.pdf
  content type: application/pdf
  size: 1234 bytes
  ZIP path: blobs/documents/default/doc-b/z
`);
  });

  it('rejects duplicate blob pathnames in backup index input', () => {
    expect(() =>
      renderBackupIndex([], [
        indexBlob('documents/default/doc-a/source'),
        indexBlob('documents/default/doc-a/source'),
      ]),
    ).toThrow('Duplicate blob pathname in backup index input');
  });

  it('rejects inconsistent metadata for rows from the same document', () => {
    const first = indexRow('doc-a', 'Umowa A', 'documents/default/doc-a/source', 'umowa-a.pdf');
    const second = {
      ...indexRow('doc-a', 'Umowa A', 'documents/default/doc-a/signed', 'umowa-a-signed.pdf'),
      person: null,
    };

    expect(() =>
      renderBackupIndex(
        [first, second],
        [
          indexBlob('documents/default/doc-a/source'),
          indexBlob('documents/default/doc-a/signed'),
        ],
      ),
    ).toThrow('Inconsistent document metadata in backup index input');
  });

  it('renders an empty archive plainly', () => {
    expect(renderBackupIndex([], [])).toBe(`Docu Signer backup index

No archived blobs.
`);
  });
});
