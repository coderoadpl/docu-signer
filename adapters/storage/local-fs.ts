import {
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import type { StorageMetadata, StoragePort } from '#core/server/index.js';

const metadataSchema = z.object({
  contentType: z.string().min(1),
});

const isOutside = (root: string, target: string): boolean => {
  const child = relative(root, target);
  return child === '..' || child.startsWith(`..${sep}`) || child === '';
};

const deepestExistingRealPath = async (target: string): Promise<string> => {
  const suffix: string[] = [];
  let current = target;
  while (true) {
    try {
      return resolve(await realpath(current), ...suffix);
    } catch (cause) {
      if (!isMissing(cause)) throw cause;
      const parent = dirname(current);
      if (parent === current) throw cause;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
};

const filePath = async (basePath: string, key: string): Promise<Result<string, AppError>> => {
  const lexicalRoot = resolve(basePath);
  const lexicalTarget = resolve(lexicalRoot, key);
  if (isOutside(lexicalRoot, lexicalTarget)) return err(internal('Invalid local storage key'));
  try {
    await mkdir(lexicalRoot, { recursive: true });
    const realRoot = await realpath(lexicalRoot);
    const realTarget = await deepestExistingRealPath(lexicalTarget);
    return isOutside(realRoot, realTarget)
      ? err(internal('Invalid local storage key'))
      : ok(realTarget);
  } catch (cause) {
    return err(internal(`Local storage path resolution failed: ${String(cause)}`));
  }
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';

const readMetadata = async (
  target: string,
  metadataTarget: string,
): Promise<Result<StorageMetadata | null, AppError>> => {
  try {
    const fileStat = await stat(target);
    if (!fileStat.isFile()) return ok(null);
    const parsed = metadataSchema.safeParse(JSON.parse(await readFile(metadataTarget, 'utf8')));
    return parsed.success
      ? ok({ contentType: parsed.data.contentType, sizeBytes: fileStat.size })
      : err(internal('Invalid local storage metadata'));
  } catch (cause) {
    return isMissing(cause)
      ? ok(null)
      : err(internal(`Local storage stat failed: ${String(cause)}`));
  }
};

export const createLocalFsStorage = (basePath: string): StoragePort => ({
  put: async (key, bytes, contentType) => {
    const target = await filePath(basePath, key);
    if (!target.ok) return target;
    const metadataTarget = await filePath(basePath, `${key}.metadata.json`);
    if (!metadataTarget.ok) return metadataTarget;
    try {
      await mkdir(dirname(target.value), { recursive: true });
      await writeFile(target.value, bytes);
      await writeFile(metadataTarget.value, JSON.stringify({ contentType }));
      return ok(undefined);
    } catch (cause) {
      return err(internal(`Local storage write failed: ${String(cause)}`));
    }
  },
  get: async (key) => {
    const target = await filePath(basePath, key);
    if (!target.ok) return target;
    try {
      return ok(new Uint8Array(await readFile(target.value)));
    } catch (cause) {
      return isMissing(cause)
        ? ok(null)
        : err(internal(`Local storage read failed: ${String(cause)}`));
    }
  },
  head: async (key) => {
    const target = await filePath(basePath, key);
    if (!target.ok) return target;
    const metadataTarget = await filePath(basePath, `${key}.metadata.json`);
    return metadataTarget.ok ? readMetadata(target.value, metadataTarget.value) : metadataTarget;
  },
  delete: async (key) => {
    const target = await filePath(basePath, key);
    if (!target.ok) return target;
    const metadataTarget = await filePath(basePath, `${key}.metadata.json`);
    if (!metadataTarget.ok) return metadataTarget;
    try {
      await unlink(target.value);
      await unlink(metadataTarget.value).catch((cause: unknown) => {
        if (!isMissing(cause)) throw cause;
      });
      return ok(undefined);
    } catch (cause) {
      return isMissing(cause)
        ? ok(undefined)
        : err(internal(`Local storage delete failed: ${String(cause)}`));
    }
  },
  createUploadUrl: async () => ok(null),
});
