import { describe, expect, it } from 'vitest';

import {
  diffManifest,
  formatArchiveName,
  inventoriesMatch,
  monthlyTransferGuard,
  parseArchiveName,
  selectRetention,
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
