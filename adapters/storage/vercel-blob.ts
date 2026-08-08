import { BlobNotFoundError, del, get, head, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import type { StoragePort } from '#core/server/index.js';

const storageResult = async <T>(operation: () => Promise<T>): Promise<Result<T, AppError>> => {
  try {
    return ok(await operation());
  } catch (cause) {
    return err(internal(`Blob storage operation failed: ${String(cause)}`));
  }
};

export const createVercelBlobStorage = (token: string): StoragePort => ({
  put: async (key, bytes, contentType) =>
    storageResult(async () => {
      await put(key, Buffer.from(bytes), { access: 'private', contentType, addRandomSuffix: false, token });
    }),
  get: async (key) =>
    storageResult(async () => {
      const result = await get(key, { access: 'private', token });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    }),
  exists: async (key) => {
    try {
      await head(key, { token });
      return ok(true);
    } catch (cause) {
      if (cause instanceof BlobNotFoundError) return ok(false);
      return err(internal(`Blob storage operation failed: ${String(cause)}`));
    }
  },
  delete: async (key) =>
    storageResult(async () => {
      await del(key, { token });
    }),
  createUploadUrl: async (key, contentType) =>
    storageResult(async () => {
      const clientToken = await generateClientTokenFromReadWriteToken({
        token,
        pathname: key,
        allowedContentTypes: [contentType],
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      const tokenMatch = /^vercel_blob_client_([^_]+)_.+$/.exec(clientToken);
      if (!tokenMatch?.[1]) throw new Error('Invalid client upload token');
      const storeId = tokenMatch[1];
      return {
        url: `https://vercel.com/api/blob/?pathname=${encodeURIComponent(key)}`,
        method: 'PUT' as const,
        headers: {
          authorization: `Bearer ${clientToken}`,
          'x-api-version': '12',
          'x-vercel-blob-access': 'private',
          'x-vercel-blob-store-id': storeId,
          'x-content-type': contentType,
        },
      };
    }),
});
