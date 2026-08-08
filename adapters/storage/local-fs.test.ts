import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createLocalFsStorage } from './local-fs.js';

describe('local filesystem storage', () => {
  it('writes, reads, and deletes bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const storage = createLocalFsStorage(root);
    expect(await storage.createUploadUrl('key', 'text/plain')).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await storage.put('documents/t/doc/file', new Uint8Array([1, 2]), 'application/pdf'),
    ).toEqual({ ok: true, value: undefined });
    expect(await storage.get('documents/t/doc/file')).toEqual({
      ok: true,
      value: new Uint8Array([1, 2]),
    });
    expect(await storage.head('documents/t/doc/file')).toEqual({
      ok: true,
      value: { contentType: 'application/pdf', sizeBytes: 2 },
    });
    expect(await storage.delete('documents/t/doc/file')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await storage.head('documents/t/doc/file')).toEqual({ ok: true, value: null });
    expect(await storage.get('documents/t/doc/file')).toEqual({ ok: true, value: null });
    expect(await storage.delete('documents/t/doc/file')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects keys outside the storage root but accepts dot-prefixed names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const storage = createLocalFsStorage(root);
    expect(await storage.put('../outside', new Uint8Array([1]), 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.get('../outside')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.head('../outside')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.delete('../outside')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.put('..file', new Uint8Array([1]), 'text/plain')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects an in-root symlink that escapes the storage root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const outside = await mkdtemp(join(tmpdir(), 'podpisy-storage-outside-'));
    await writeFile(join(outside, 'existing'), new Uint8Array([9]));
    await symlink(outside, join(root, 'escape'));
    const storage = createLocalFsStorage(root);

    expect(
      await storage.put('escape/new', new Uint8Array([1]), 'application/pdf'),
    ).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await storage.get('escape/existing')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.head('escape/existing')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.delete('escape/existing')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await readFile(join(outside, 'existing'))).toEqual(Buffer.from([9]));
  });

  it('rejects an escaping metadata-sidecar symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const outside = await mkdtemp(join(tmpdir(), 'podpisy-storage-outside-'));
    const outsideMetadata = join(outside, 'metadata');
    await writeFile(outsideMetadata, 'unchanged');
    await symlink(outsideMetadata, join(root, 'file.metadata.json'));
    const storage = createLocalFsStorage(root);

    expect(await storage.put('file', new Uint8Array([1]), 'application/pdf')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await readFile(outsideMetadata, 'utf8')).toBe('unchanged');
  });
});
