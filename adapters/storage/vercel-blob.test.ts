import { describe, expect, it } from 'vitest';

import { createVercelBlobStorage } from './vercel-blob.js';

describe('Vercel Blob storage', () => {
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

  it('returns an internal Result for an invalid token', async () => {
    const storage = createVercelBlobStorage('invalid');
    expect(await storage.createUploadUrl('key', 'text/plain')).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });
});
