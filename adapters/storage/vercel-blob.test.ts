import { BlobNotFoundError } from '@vercel/blob';
import type * as VercelBlob from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  del: vi.fn<(key: string, options: unknown) => Promise<void>>(),
  generateClientToken: vi.fn<() => Promise<string>>(),
  get: vi.fn<(key: string, options: unknown) => Promise<unknown>>(),
  head: vi.fn<() => Promise<unknown>>(),
  list: vi.fn<(options: unknown) => Promise<unknown>>(),
  put: vi.fn<(key: string, body: unknown, options: unknown) => Promise<unknown>>(),
}));

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof VercelBlob>()),
  del: mocks.del,
  get: mocks.get,
  head: mocks.head,
  list: mocks.list,
  put: mocks.put,
}));

vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: mocks.generateClientToken,
}));

import { createVercelBlobBackupStorage, createVercelBlobStorage } from './vercel-blob.js';

describe('Vercel Blob storage', () => {
  beforeEach(() => {
    mocks.generateClientToken.mockReset().mockResolvedValue('vercel_blob_client_store_payload');
    mocks.del.mockReset().mockResolvedValue(undefined);
    mocks.get.mockReset().mockResolvedValue(null);
    mocks.head.mockReset().mockResolvedValue({ contentType: 'application/pdf', size: 3 });
    mocks.list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
    mocks.put.mockReset().mockResolvedValue({});
  });

  it('creates a constrained direct upload target', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    expect(
      await storage.createUploadUrl('documents/t/doc/file', 'application/pdf'),
    ).toMatchObject({
      ok: true,
      value: {
        url: 'https://vercel.com/api/blob/?pathname=documents%2Ft%2Fdoc%2Ffile',
        method: 'PUT',
        headers: {
          authorization: 'Bearer vercel_blob_client_store_payload',
          'x-api-version': '12',
          'x-vercel-blob-access': 'private',
          'x-vercel-blob-store-id': 'store',
          'x-content-type': 'application/pdf',
        },
      },
    });
    expect(mocks.generateClientToken).toHaveBeenCalledWith(
      expect.objectContaining({ maximumSizeInBytes: 25 * 1024 * 1024 }),
    );
  });

  it('puts overwriteable private bytes and deletes by key', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    expect(
      await storage.put('documents/t/doc/file', new Uint8Array([1, 2, 3]), 'application/pdf'),
    ).toEqual({ ok: true, value: undefined });
    expect(mocks.put).toHaveBeenCalledWith(
      'documents/t/doc/file',
      Buffer.from([1, 2, 3]),
      {
        access: 'private',
        contentType: 'application/pdf',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: 'vercel_blob_rw_store_secret',
      },
    );
    expect(await storage.delete('documents/t/doc/file')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(mocks.del).toHaveBeenCalledWith('documents/t/doc/file', {
      token: 'vercel_blob_rw_store_secret',
    });
  });

  it('converts a successful response stream and maps missing or non-200 blobs to null', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    mocks.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      }),
    });
    expect(await storage.get('present')).toEqual({
      ok: true,
      value: new Uint8Array([1, 2, 3]),
    });
    expect(mocks.get).toHaveBeenCalledWith('present', {
      access: 'private',
      token: 'vercel_blob_rw_store_secret',
    });
    mocks.get.mockResolvedValueOnce(null);
    expect(await storage.get('missing')).toEqual({ ok: true, value: null });
    mocks.get.mockResolvedValueOnce({ statusCode: 304, stream: null });
    expect(await storage.get('not-modified')).toEqual({ ok: true, value: null });
  });

  it('reads metadata and maps a missing blob', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    expect(await storage.head('present')).toEqual({
      ok: true,
      value: { contentType: 'application/pdf', sizeBytes: 3 },
    });
    expect(mocks.head).toHaveBeenCalledWith('present', {
      token: 'vercel_blob_rw_store_secret',
    });
    mocks.head.mockRejectedValueOnce(new BlobNotFoundError());
    expect(await storage.head('missing')).toEqual({ ok: true, value: null });
  });

  it('maps operation rejections to internal errors', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    mocks.generateClientToken.mockResolvedValueOnce('malformed');
    expect(await storage.createUploadUrl('key', 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    mocks.put.mockRejectedValueOnce(new Error('put unavailable'));
    expect(await storage.put('key', new Uint8Array([1]), 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    mocks.get.mockRejectedValueOnce(new Error('get unavailable'));
    expect(await storage.get('key')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    mocks.del.mockRejectedValueOnce(new Error('delete unavailable'));
    expect(await storage.delete('key')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    mocks.head.mockRejectedValueOnce(new Error('unavailable'));
    expect(await storage.head('failed')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('paginates backup inventory and streams private content', async () => {
    const storage = createVercelBlobBackupStorage('vercel_blob_rw_store_secret');
    mocks.list.mockResolvedValueOnce({
      blobs: [{ pathname: 'documents/file', etag: 'etag-1', size: 3 }],
      hasMore: true,
      cursor: 'next-page',
    });
    expect(await storage.listPage(null)).toEqual({
      ok: true,
      value: {
        items: [{ pathname: 'documents/file', etag: 'etag-1', sizeBytes: 3 }],
        nextCursor: 'next-page',
      },
    });
    expect(mocks.list).toHaveBeenCalledWith({
      limit: 1000,
      token: 'vercel_blob_rw_store_secret',
    });

    const stream = new ReadableStream<Uint8Array>();
    mocks.get.mockResolvedValueOnce({
      statusCode: 200,
      stream,
      blob: {
        pathname: 'documents/file',
        etag: 'etag-1',
        size: 3,
        contentType: 'application/pdf',
      },
    });
    expect(await storage.getStream('documents/file')).toEqual({
      ok: true,
      value: {
        pathname: 'documents/file',
        etag: 'etag-1',
        sizeBytes: 3,
        contentType: 'application/pdf',
        stream,
      },
    });
    expect(mocks.get).toHaveBeenCalledWith('documents/file', {
      access: 'private',
      token: 'vercel_blob_rw_store_secret',
      useCache: false,
    });
  });

  it('rejects malformed backup pages and maps missing backup content', async () => {
    const storage = createVercelBlobBackupStorage('vercel_blob_rw_store_secret');
    mocks.list.mockResolvedValueOnce({ blobs: [], hasMore: true });
    expect(await storage.listPage('cursor')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    mocks.get.mockResolvedValueOnce(null);
    expect(await storage.getStream('missing')).toEqual({ ok: true, value: null });
  });
});
