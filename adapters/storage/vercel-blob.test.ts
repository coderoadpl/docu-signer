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
    const result = await storage.createUploadUrl('documents/t/doc/file', 'application/pdf');
    expect(result).toMatchObject({
      ok: true,
      value: {
        method: 'PUT',
        headers: {
          'x-vercel-blob-access': 'private',
          'x-vercel-blob-store-id': 'store',
          'x-content-type': 'application/pdf',
        },
      },
    });
  });

  it('returns an internal Result for a malformed client token', async () => {
    mocks.generateClientToken.mockResolvedValue('malformed');
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    expect(await storage.createUploadUrl('key', 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('checks blob existence and maps a missing blob', async () => {
    const storage = createVercelBlobStorage('vercel_blob_rw_store_secret');
    expect(await storage.exists('present')).toEqual({ ok: true, value: true });

    mocks.head.mockRejectedValueOnce(new BlobNotFoundError());
    expect(await storage.exists('missing')).toEqual({ ok: true, value: false });

    mocks.head.mockRejectedValueOnce(new Error('unavailable'));
    expect(await storage.exists('failed')).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});
