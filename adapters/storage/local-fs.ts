import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import type { StoragePort } from '#core/server/index.js';

const filePath = (basePath: string, key: string): Result<string, AppError> => {
  const resolved = resolve(basePath, key);
  const child = relative(basePath, resolved);
  return child === '..' || child.startsWith(`..${sep}`) || child === ''
    ? err(internal('Invalid local storage key'))
    : ok(resolved);
};

export const createLocalFsStorage = (basePath: string): StoragePort => ({
  put: async (key, bytes) => {
    const target = filePath(basePath, key);
    if (!target.ok) return target;
    try {
      await mkdir(dirname(target.value), { recursive: true });
      await writeFile(target.value, bytes);
      return ok(undefined);
    } catch (cause) {
      return err(internal(`Local storage write failed: ${String(cause)}`));
    }
  },
  get: async (key) => {
    const target = filePath(basePath, key);
    if (!target.ok) return target;
    try {
      return ok(new Uint8Array(await readFile(target.value)));
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ok(null);
      return err(internal(`Local storage read failed: ${String(cause)}`));
    }
  },
  exists: async (key) => {
    const target = filePath(basePath, key);
    if (!target.ok) return target;
    try {
      return ok((await stat(target.value)).isFile());
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ok(false);
      return err(internal(`Local storage stat failed: ${String(cause)}`));
    }
  },
  delete: async (key) => {
    const target = filePath(basePath, key);
    if (!target.ok) return target;
    try {
      await unlink(target.value);
      return ok(undefined);
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ok(undefined);
      return err(internal(`Local storage delete failed: ${String(cause)}`));
    }
  },
  createUploadUrl: async () => ok(null),
});
