import { BlobNotFoundError, del, get, head, list, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { z } from 'zod';

import {
  err,
  internal,
  MAX_DOCUMENT_FILE_BYTES,
  ok,
  type AppError,
  type Result,
} from '#core/domain/index.js';
import type { BackupStoragePort, StoragePort } from '#core/server/index.js';

const backupListSchema = z.object({
  blobs: z.array(
    z.object({
      pathname: z.string().min(1),
      etag: z.string().min(1),
      size: z.number().int().nonnegative(),
    }),
  ),
  cursor: z.string().min(1).optional(),
  hasMore: z.boolean(),
});

const backupGetMetadataSchema = z.object({
  pathname: z.string().min(1),
  etag: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

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
      await put(key, Buffer.from(bytes), {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        token,
      });
    }),
  get: async (key) =>
    storageResult(async () => {
      const result = await get(key, { access: 'private', token });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    }),
  head: async (key) => {
    try {
      const metadata = await head(key, { token });
      return ok({ contentType: metadata.contentType, sizeBytes: metadata.size });
    } catch (cause) {
      return cause instanceof BlobNotFoundError
        ? ok(null)
        : err(internal(`Blob storage operation failed: ${String(cause)}`));
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
        maximumSizeInBytes: MAX_DOCUMENT_FILE_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      const storeId = /^vercel_blob_client_([^_]+)_.+$/.exec(clientToken)?.[1];
      if (!storeId) throw new Error('Invalid client upload token');
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

export const createVercelBlobBackupStorage = (token: string): BackupStoragePort => ({
  listPage: async (cursor) =>
    storageResult(async () => {
      const result = backupListSchema.parse(
        await list({ limit: 1000, token, ...(cursor === null ? {} : { cursor }) }),
      );
      if (result.hasMore && result.cursor === undefined) {
        throw new Error('Blob list response omitted its pagination cursor');
      }
      return {
        items: result.blobs.map((blob) => ({
          pathname: blob.pathname,
          etag: blob.etag,
          sizeBytes: blob.size,
        })),
        nextCursor: result.hasMore ? (result.cursor ?? null) : null,
      };
    }),
  getStream: async (key) =>
    storageResult(async () => {
      const result = await get(key, { access: 'private', token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      const metadata = backupGetMetadataSchema.parse(result.blob);
      return {
        pathname: metadata.pathname,
        etag: metadata.etag,
        sizeBytes: metadata.size,
        contentType: metadata.contentType,
        stream: result.stream,
      };
    }),
});
