import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createLocalFsStorage } from './local-fs.js';

describe('local filesystem storage', () => {
  it('writes, reads, and deletes bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const storage = createLocalFsStorage(root);
    expect(await storage.createUploadUrl('key', 'text/plain')).toEqual({ ok: true, value: null });
    expect(await storage.put('documents/t/doc/file', new Uint8Array([1, 2]), 'application/pdf')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await storage.get('documents/t/doc/file')).toEqual({ ok: true, value: new Uint8Array([1, 2]) });
    expect(await storage.exists('documents/t/doc/file')).toEqual({ ok: true, value: true });
    expect(await storage.delete('documents/t/doc/file')).toEqual({ ok: true, value: undefined });
    expect(await storage.exists('documents/t/doc/file')).toEqual({ ok: true, value: false });
    expect(await storage.get('documents/t/doc/file')).toEqual({ ok: true, value: null });
    expect(await storage.delete('documents/t/doc/file')).toEqual({ ok: true, value: undefined });
  });

  it('rejects keys outside the storage root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const storage = createLocalFsStorage(root);
    expect(await storage.put('../outside', new Uint8Array([1]), 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.get('../outside')).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await storage.exists('../outside')).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(await storage.delete('../outside')).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('allows keys whose names start with two dots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podpisy-storage-'));
    const storage = createLocalFsStorage(root);
    expect(await storage.put('..file', new Uint8Array([1]), 'text/plain')).toEqual({ ok: true, value: undefined });
    expect(await storage.exists('..file')).toEqual({ ok: true, value: true });
  });
});
