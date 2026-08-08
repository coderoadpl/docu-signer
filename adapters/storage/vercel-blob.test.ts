import { BlobNotFoundError } from '@vercel/blob';
import type * as VercelBlob from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateClientToken: vi.fn<() => Promise<string>>(),
  head: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof VercelBlob>()),
  head: mocks.head,
}));

vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: mocks.generateClientToken,
}));

import { createVercelBlobStorage } from './vercel-blob.js';

describe('Vercel Blob storage', () => {
  beforeEach(() => {
    mocks.generateClientToken.mockReset().mockResolvedValue('vercel_blob_client_store_payload');
    mocks.head.mockReset().mockResolvedValue({});
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

  it('maps malformed tokens, missing blobs, and storage failures', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    mocks.generateClientToken.mockResolvedValueOnce('malformed');
    expect(await storage.createUploadUrl('key', 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
    expect(await storage.exists('present')).toEqual({ ok: true, value: true });
    mocks.head.mockRejectedValueOnce(new BlobNotFoundError());
    expect(await storage.exists('missing')).toEqual({ ok: true, value: false });
    mocks.head.mockRejectedValueOnce(new Error('unavailable'));
    expect(await storage.exists('failed')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });
});
