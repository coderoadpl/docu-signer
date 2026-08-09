import { spawn } from 'node:child_process';
import { createHash, randomUUID, sign } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { createVercelBlobBackupStorage } from '#adapters/storage/vercel-blob.js';
import { backupEnvSchema } from '#core/server/config.js';
import type { BackupStoragePort } from '#core/server/index.js';

import {
  diffManifest,
  formatArchiveName,
  inventoriesMatch,
  monthKey,
  monthlyTransferGuard,
  parseArchiveName,
  pgEnvFromDatabaseUrl,
  renderBackupIndex,
  selectRetention,
  type BackupIndexRow,
  type BlobInventoryItem,
  type BlobManifestItem,
  type MonthlyTransferState,
} from './backup-logic.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const ZIP_CONTENT_TYPE = 'application/zip';
const FORMAT_VERSION = 1;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const TRANSFER_LEDGER_NAME = 'docu-signer-backup-transfer-ledger.json';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const byteStringSchema = z.string().regex(/^\d+$/);

const manifestItemSchema = z.object({
  pathname: z.string().min(1),
  etag: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  sha256: sha256Schema,
});

const backupMetadataSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  archiveName: z.string().min(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  database: z.object({
    name: z.string().min(1),
    serverVersion: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
  blobs: z.object({
    count: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    downloadedThisRunBytes: z.number().int().nonnegative(),
    reusedFromPrevious: z.number().int().nonnegative(),
  }),
  transfer: z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    downloadedMonthToDateBytes: z.number().int().nonnegative(),
    monthlyCeilingBytes: z.number().int().nonnegative(),
  }),
});

type BackupMetadata = z.infer<typeof backupMetadataSchema>;

const backupIndexRowSchema = z.object({
  documentId: z.uuid(),
  documentTitle: z.string(),
  docType: z.string(),
  person: z.string().nullable(),
  role: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  pathname: z.string().min(1),
});

const serviceAccountSchema = z.object({
  client_email: z.email(),
  private_key: z.string().min(1),
  token_uri: z.url().default('https://oauth2.googleapis.com/token'),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().min(1),
});

const driveFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: byteStringSchema,
  createdTime: z.iso.datetime(),
  appProperties: z.record(z.string(), z.string()).optional(),
});

type DriveFile = z.infer<typeof driveFileSchema>;

const transferLedgerSchema = z.object({
  formatVersion: z.literal(FORMAT_VERSION),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  bytesDownloaded: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

type TransferLedger = z.infer<typeof transferLedgerSchema>;

const driveListSchema = z.object({
  nextPageToken: z.string().min(1).optional(),
  files: z.array(driveFileSchema),
});

type BackupEnv = z.infer<typeof backupEnvSchema>;

interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdoutFile?: FileHandle;
  readonly redact?: readonly string[];
}

const redactText = (value: string, secrets: readonly string[]): string =>
  secrets.reduce((text, secret) => (secret.length > 0 ? text.replaceAll(secret, '[redacted]') : text), value);

const commandFailure = (
  command: string,
  code: number | null,
  stderr: string,
  redact: readonly string[],
): Error => {
  const detail = redactText(stderr.trim(), redact);
  return new Error(
    `${command} failed${code === null ? '' : ` with exit ${code}`}${detail.length === 0 ? '' : `: ${detail}`}`,
  );
};

const runCommand = async (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<void> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdio: ['ignore', options.stdoutFile?.fd ?? 'ignore', 'pipe'],
    });
    let stderr = '';
    const stderrStream = child.stderr;
    if (!stderrStream) {
      child.kill();
      rejectPromise(new Error(`${command} did not expose stderr`));
      return;
    }
    stderrStream.setEncoding('utf8');
    stderrStream.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(commandFailure(command, code, stderr, options.redact ?? []));
    });
  });

const captureCommand = async (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(commandFailure(command, code, stderr, options.redact ?? []));
    });
  });

const pgCommandOptions = (
  databaseUrl: string,
): Pick<CommandOptions, 'env' | 'redact'> => {
  // libpq does not expand connection URIs supplied through PGDATABASE.
  const pgEnv = pgEnvFromDatabaseUrl(databaseUrl);
  return {
    env: { ...process.env, ...pgEnv },
    redact: [databaseUrl, pgEnv.PGPASSWORD],
  };
};

const sha256File = async (path: string): Promise<string> => {
  const handle = await open(path, 'r');
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
    }
    return digest.digest('hex');
  } finally {
    await handle.close();
  }
};

const safeBlobPath = (pathname: string): readonly string[] => {
  const parts = pathname.split('/');
  if (
    pathname.startsWith('/') ||
    pathname.includes('\\') ||
    pathname.includes('\n') ||
    pathname.includes('\r') ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new Error('Blob inventory contains an unsafe pathname');
  }
  return parts;
};

const validateArchiveEntryNames = (entries: string): void => {
  for (const rawEntry of entries.trimEnd().split('\n')) {
    const entry = rawEntry.endsWith('/') ? rawEntry.slice(0, -1) : rawEntry;
    if (entry.length === 0) continue;
    const parts = entry.split('/');
    if (
      entry.startsWith('/') ||
      entry.includes('\\') ||
      entry.includes('\r') ||
      parts.some((part) => part.length === 0 || part === '.' || part === '..')
    ) {
      throw new Error('Previous archive contains an unsafe entry path');
    }
  }
};

const blobFilePath = (bundleDir: string, pathname: string): string =>
  join(bundleDir, 'blobs', ...safeBlobPath(pathname));

const listFiles = async (root: string, current = root): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Backup archive contains a symbolic link');
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
    else throw new Error('Backup archive contains a non-file entry');
  }
  return files.sort();
};

const parseChecksumFile = (text: string): Map<string, string> => {
  const checksums = new Map<string, string>();
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    const digest = match?.[1];
    const path = match?.[2];
    if (!digest || !path || checksums.has(path)) throw new Error('Invalid SHA256SUMS');
    checksums.set(path, digest);
  }
  return checksums;
};

interface ValidBundle {
  readonly manifest: readonly BlobManifestItem[];
  readonly metadata: BackupMetadata;
}

const validateBundle = async (bundleDir: string, archiveName: string): Promise<ValidBundle> => {
  const manifest = z
    .array(manifestItemSchema)
    .parse(JSON.parse(await readFile(join(bundleDir, 'blobs-manifest.json'), 'utf8')));
  const metadata = backupMetadataSchema.parse(
    JSON.parse(await readFile(join(bundleDir, 'backup.json'), 'utf8')),
  );
  if (metadata.archiveName !== archiveName) throw new Error('Backup metadata name mismatch');

  const files = await listFiles(bundleDir);
  const contentFiles = files.filter((path) => path !== 'SHA256SUMS');
  const checksums = parseChecksumFile(await readFile(join(bundleDir, 'SHA256SUMS'), 'utf8'));
  if (
    checksums.size !== contentFiles.length ||
    contentFiles.some((path) => !checksums.has(path))
  ) {
    throw new Error('Backup checksum inventory mismatch');
  }
  for (const [path, digest] of checksums) {
    if (await sha256File(join(bundleDir, ...path.split('/'))) !== digest) {
      throw new Error('Backup checksum verification failed');
    }
  }

  const manifestByPath = new Map<string, BlobManifestItem>();
  for (const item of manifest) {
    safeBlobPath(item.pathname);
    if (manifestByPath.has(item.pathname)) throw new Error('Duplicate pathname in blob manifest');
    manifestByPath.set(item.pathname, item);
    const path = blobFilePath(bundleDir, item.pathname);
    const fileStat = await stat(path);
    if (fileStat.size !== item.sizeBytes || (await sha256File(path)) !== item.sha256) {
      throw new Error('Blob mirror verification failed');
    }
  }
  const archivedBlobPaths = files
    .filter((path) => path.startsWith('blobs/'))
    .map((path) => path.slice('blobs/'.length));
  if (
    archivedBlobPaths.length !== manifest.length ||
    archivedBlobPaths.some((path) => !manifestByPath.has(path))
  ) {
    throw new Error('Blob mirror inventory mismatch');
  }
  const totalBytes = manifest.reduce((total, item) => total + item.sizeBytes, 0);
  if (metadata.blobs.count !== manifest.length || metadata.blobs.totalBytes !== totalBytes) {
    throw new Error('Backup summary mismatch');
  }
  return { manifest, metadata };
};

const base64Url = (value: string): string => Buffer.from(value).toString('base64url');

const fetchDriveAccessToken = async (
  serviceAccountJson: string,
): Promise<{ readonly accessToken: string; readonly serviceAccount: string }> => {
  const serviceAccount = serviceAccountSchema.parse(JSON.parse(serviceAccountJson));
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: DRIVE_SCOPE,
      aud: serviceAccount.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key).toString(
    'base64url',
  );
  const response = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Google OAuth failed with status ${response.status}`);
  const token = tokenResponseSchema.parse(await response.json());
  return { accessToken: token.access_token, serviceAccount: serviceAccount.client_email };
};

const withAllDrives = (rawUrl: string): string => {
  const url = new URL(rawUrl);
  url.searchParams.set('supportsAllDrives', 'true');
  return url.toString();
};

class DriveClient {
  readonly #accessToken: string;
  readonly #folderId: string;

  constructor(accessToken: string, folderId: string) {
    this.#accessToken = accessToken;
    this.#folderId = folderId;
  }

  async #fetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.#accessToken}`);
    return fetch(withAllDrives(rawUrl), { ...init, headers });
  }

  async listBackups(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | null = null;
    do {
      const url = new URL(`${DRIVE_API}/files`);
      url.searchParams.set(
        'q',
        `'${this.#folderId}' in parents and trashed = false and mimeType = '${ZIP_CONTENT_TYPE}'`,
      );
      url.searchParams.set('fields', 'nextPageToken,files(id,name,size,createdTime,appProperties)');
      url.searchParams.set('pageSize', '1000');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      url.searchParams.set('corpora', 'allDrives');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.#fetch(url.toString());
      if (!response.ok) throw new Error(`Drive list failed with status ${response.status}`);
      const page = driveListSchema.parse(await response.json());
      files.push(...page.files);
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null);
    return files;
  }

  async transferLedger(): Promise<{ readonly file: DriveFile; readonly ledger: TransferLedger } | null> {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set(
      'q',
      `'${this.#folderId}' in parents and trashed = false and name = '${TRANSFER_LEDGER_NAME}'`,
    );
    url.searchParams.set('fields', 'files(id,name,size,createdTime,appProperties)');
    url.searchParams.set('pageSize', '2');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('corpora', 'allDrives');
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`Drive transfer ledger list failed with status ${response.status}`);
    const files = driveListSchema.parse(await response.json()).files;
    if (files.length > 1) throw new Error('Drive contains more than one backup transfer ledger');
    const file = files[0];
    if (!file) return null;
    return { file, ledger: await this.#readTransferLedger(file.id) };
  }

  async #readTransferLedger(id: string): Promise<TransferLedger> {
    const response = await this.#fetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
    if (!response.ok) throw new Error(`Drive transfer ledger read failed with status ${response.status}`);
    return transferLedgerSchema.parse(await response.json());
  }

  async reserveTransfer(existingId: string | null, ledger: TransferLedger): Promise<void> {
    const content = JSON.stringify(ledger);
    let id = existingId;
    if (id) {
      const response = await this.#fetch(
        `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: content,
        },
      );
      if (!response.ok) {
        throw new Error(`Drive transfer ledger update failed with status ${response.status}`);
      }
    } else {
      const boundary = `docu-signer-${randomUUID()}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name: TRANSFER_LEDGER_NAME, parents: [this.#folderId] })}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
        `--${boundary}--`;
      const url = new URL(`${DRIVE_UPLOAD_API}/files`);
      url.searchParams.set('uploadType', 'multipart');
      url.searchParams.set('fields', 'id,name,size,createdTime,appProperties');
      const response = await this.#fetch(url.toString(), {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      });
      if (!response.ok) {
        throw new Error(`Drive transfer ledger creation failed with status ${response.status}`);
      }
      id = driveFileSchema.parse(await response.json()).id;
    }
    const verified = await this.#readTransferLedger(id);
    if (
      verified.month !== ledger.month ||
      verified.bytesDownloaded !== ledger.bytesDownloaded ||
      verified.updatedAt !== ledger.updatedAt
    ) {
      throw new Error('Drive transfer reservation verification failed');
    }
  }

  async download(file: DriveFile, target: string): Promise<void> {
    const response = await this.#fetch(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
    if (!response.ok || !response.body) {
      throw new Error(`Drive download failed with status ${response.status}`);
    }
    const handle = await open(target, 'wx');
    try {
      await writeStream(response.body, handle);
    } finally {
      await handle.close();
    }
  }

  async upload(
    archivePath: string,
    archiveName: string,
    archiveSize: number,
    archiveSha256: string,
    transfer: MonthlyTransferState,
  ): Promise<DriveFile> {
    const startUrl = new URL(`${DRIVE_UPLOAD_API}/files`);
    startUrl.searchParams.set('uploadType', 'resumable');
    startUrl.searchParams.set('fields', 'id,name,size,createdTime,appProperties');
    const start = await this.#fetch(startUrl.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': archiveSize.toString(),
        'x-upload-content-type': ZIP_CONTENT_TYPE,
      },
      body: JSON.stringify({
        name: archiveName,
        mimeType: ZIP_CONTENT_TYPE,
        parents: [this.#folderId],
        appProperties: {
          archiveSha256,
          formatVersion: FORMAT_VERSION.toString(),
          transferMonth: transfer.month,
          blobBytesMonthToDate: transfer.bytesDownloaded.toString(),
        },
      }),
    });
    if (!start.ok) throw new Error(`Drive resumable upload start failed with status ${start.status}`);
    const location = start.headers.get('location');
    if (!location) throw new Error('Drive resumable upload did not return a session URL');

    const handle = await open(archivePath, 'r');
    const buffer = Buffer.allocUnsafe(UPLOAD_CHUNK_BYTES);
    let offset = 0;
    let uploaded: DriveFile | null = null;
    try {
      while (offset < archiveSize) {
        const length = Math.min(buffer.length, archiveSize - offset);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead === 0) throw new Error('Archive ended during Drive upload');
        const lastByte = offset + bytesRead - 1;
        const response = await this.#fetch(location, {
          method: 'PUT',
          headers: {
            'content-length': bytesRead.toString(),
            'content-range': `bytes ${offset}-${lastByte}/${archiveSize}`,
            'content-type': ZIP_CONTENT_TYPE,
          },
          body: buffer.subarray(0, bytesRead),
        });
        if (response.status === 308) {
          offset += bytesRead;
          continue;
        }
        if (!response.ok) throw new Error(`Drive upload failed with status ${response.status}`);
        uploaded = driveFileSchema.parse(await response.json());
        offset += bytesRead;
      }
    } finally {
      await handle.close();
    }
    if (!uploaded || offset !== archiveSize) throw new Error('Drive upload did not complete');
    return uploaded;
  }

  async metadata(id: string): Promise<DriveFile> {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
    url.searchParams.set('fields', 'id,name,size,createdTime,appProperties');
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`Drive metadata read failed with status ${response.status}`);
    return driveFileSchema.parse(await response.json());
  }

  async trash(id: string): Promise<void> {
    const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(id)}`);
    url.searchParams.set('fields', 'id,trashed');
    const response = await this.#fetch(url.toString(), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!response.ok) throw new Error(`Drive retention update failed with status ${response.status}`);
  }
}

const writeStream = async (
  stream: ReadableStream<Uint8Array>,
  handle: FileHandle,
  digest?: ReturnType<typeof createHash>,
  maximumBytes?: number,
): Promise<number> => {
  const reader = stream.getReader();
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (maximumBytes !== undefined && total + result.value.length > maximumBytes) {
        throw new Error('Download exceeded its declared size');
      }
      let written = 0;
      while (written < result.value.length) {
        const write = await handle.write(
          result.value,
          written,
          result.value.length - written,
          null,
        );
        written += write.bytesWritten;
      }
      digest?.update(result.value);
      total += result.value.length;
    }
    return total;
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause;
  } finally {
    reader.releaseLock();
  }
};

const listAllBlobs = async (storage: BackupStoragePort): Promise<BlobInventoryItem[]> => {
  const items: BlobInventoryItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await storage.listPage(cursor);
    if (!page.ok) throw new Error('Vercel Blob inventory listing failed');
    items.push(...page.value.items);
    cursor = page.value.nextCursor;
    if (cursor && seenCursors.has(cursor)) throw new Error('Vercel Blob pagination cursor repeated');
    if (cursor) seenCursors.add(cursor);
  } while (cursor !== null);
  for (const item of items) safeBlobPath(item.pathname);
  return items;
};

const databaseDetails = async (
  databaseUrl: string,
): Promise<{
  readonly name: string;
  readonly sizeBytes: number;
  readonly serverVersion: string;
}> => {
  const output = await captureCommand(
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      "SELECT current_database() || E'\\t' || pg_database_size(current_database())::text || E'\\t' || current_setting('server_version')",
    ],
    pgCommandOptions(databaseUrl),
  );
  const match = /^([^\t]+)\t(\d+)\t(.+)$/.exec(output.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error('Could not parse database name, size, and version');
  }
  const sizeBytes = Number(match[2]);
  if (!Number.isSafeInteger(sizeBytes)) throw new Error('Database size is outside the safe range');
  return { name: match[1], sizeBytes, serverVersion: match[3] };
};

const dumpDatabase = async (databaseUrl: string, target: string): Promise<void> => {
  await unlink(target).catch((cause: unknown) => {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
  });
  await runCommand(
    'pg_dump',
    ['--format=plain', '--no-owner', '--no-acl', `--file=${target}`],
    pgCommandOptions(databaseUrl),
  );
};

export const readBackupIndexRows = async (databaseUrl: string): Promise<readonly BackupIndexRow[]> => {
  const output = await captureCommand(
    'psql',
    [
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      `SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'documentId', d.id::text,
      'documentTitle', d.title,
      'docType', d.doc_type,
      'person', d.person,
      'role', f.role,
      'fileName', f.file_name,
      'contentType', f.content_type,
      'sizeBytes', f.size_bytes,
      'pathname', f.storage_key
    )
    ORDER BY lower(d.title), d.title, d.id::text, f.role, f.file_name, f.id::text
  ),
  '[]'::jsonb
)::text
FROM documents d
JOIN document_files f ON f.document_id = d.id`,
    ],
    pgCommandOptions(databaseUrl),
  );
  return z.array(backupIndexRowSchema).parse(JSON.parse(output.trim()));
};

interface PreviousBackup {
  readonly manifest: readonly BlobManifestItem[];
  readonly metadata: BackupMetadata;
}

const loadPreviousBackup = async (
  drive: DriveClient,
  driveFiles: readonly DriveFile[],
  workDir: string,
  bundleDir: string,
): Promise<PreviousBackup | null> => {
  const candidates = driveFiles
    .map((file) => ({ file, timestamp: parseArchiveName(file.name) }))
    .filter((candidate): candidate is { file: DriveFile; timestamp: Date } =>
      candidate.timestamp !== null,
    )
    .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

  for (const [index, candidate] of candidates.entries()) {
    const expectedSha256 = candidate.file.appProperties?.['archiveSha256'];
    if (!expectedSha256 || !sha256Schema.safeParse(expectedSha256).success) continue;
    const archivePath = join(workDir, `previous-${index}.zip`);
    const candidateDir = join(workDir, `previous-${index}`);
    await drive.download(candidate.file, archivePath);
    try {
      const fileStat = await stat(archivePath);
      if (
        fileStat.size !== Number(candidate.file.size) ||
        (await sha256File(archivePath)) !== expectedSha256
      ) {
        throw new Error('Previous archive metadata verification failed');
      }
      await runCommand('unzip', ['-tq', archivePath]);
      validateArchiveEntryNames(await captureCommand('unzip', ['-Z1', archivePath]));
      await mkdir(candidateDir);
      await runCommand('unzip', ['-q', archivePath, '-d', candidateDir]);
      const valid = await validateBundle(candidateDir, candidate.file.name);
      await rename(candidateDir, bundleDir);
      process.stdout.write('Previous Drive backup verified; using it as the local Blob mirror.\n');
      return valid;
    } catch {
      await rm(candidateDir, { recursive: true, force: true });
      process.stdout.write('Previous backup candidate was corrupt or unusable; trying an older copy.\n');
    }
  }

  await mkdir(join(bundleDir, 'blobs'), { recursive: true });
  process.stdout.write(
    'No valid previous Drive backup is available; falling back to a full Vercel Blob download.\n',
  );
  return null;
};

const driveTransferState = (
  files: readonly DriveFile[],
  runAt: Date,
): MonthlyTransferState | null => {
  const month = monthKey(runAt);
  let bytesDownloaded = -1;
  for (const file of files) {
    const properties = file.appProperties;
    if (properties?.['transferMonth'] !== month) continue;
    const rawBytes = properties['blobBytesMonthToDate'];
    if (!rawBytes || !byteStringSchema.safeParse(rawBytes).success) continue;
    bytesDownloaded = Math.max(bytesDownloaded, Number(rawBytes));
  }
  return bytesDownloaded < 0 ? null : { month, bytesDownloaded };
};

const removeDeletedMirrorFiles = async (
  bundleDir: string,
  deleted: readonly BlobManifestItem[],
): Promise<void> => {
  for (const item of deleted) await rm(blobFilePath(bundleDir, item.pathname), { force: true });
};

const downloadBlob = async (
  storage: BackupStoragePort,
  bundleDir: string,
  item: BlobInventoryItem,
): Promise<BlobManifestItem> => {
  const result = await storage.getStream(item.pathname);
  if (!result.ok || !result.value) throw new Error('A listed Vercel Blob could not be downloaded');
  if (
    result.value.pathname !== item.pathname ||
    result.value.etag !== item.etag ||
    result.value.sizeBytes !== item.sizeBytes
  ) {
    throw new Error('Vercel Blob metadata changed during download');
  }
  const target = blobFilePath(bundleDir, item.pathname);
  const temporary = `${target}.download-${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(temporary, 'wx');
  const digest = createHash('sha256');
  try {
    const bytesWritten = await writeStream(
      result.value.stream,
      handle,
      digest,
      item.sizeBytes,
    );
    if (bytesWritten !== item.sizeBytes) throw new Error('Vercel Blob download size mismatch');
  } catch (cause) {
    await handle.close();
    await rm(temporary, { force: true });
    throw cause;
  }
  await handle.close();
  await rename(temporary, target);
  return {
    pathname: item.pathname,
    etag: item.etag,
    sizeBytes: item.sizeBytes,
    contentType: result.value.contentType,
    sha256: digest.digest('hex'),
  };
};

const restoreText = `Docu Signer backup format ${FORMAT_VERSION}

1. Stop application writes. Verify every entry in SHA256SUMS and every blob size/hash in blobs-manifest.json.
2. Create an empty Neon database on the same or a newer PostgreSQL major version. Restore with:
   psql "$TARGET_DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f database.sql
3. Create an empty private Vercel Blob store. For every manifest entry upload blobs/<pathname> with put(pathname, stream, { access: 'private', addRandomSuffix: false, contentType }).
4. Use INDEX.txt to identify document files during triage. Verify every restored document_files.storage_key exists and matches the manifest size, content type, and SHA-256.
5. Configure the new database URLs and Blob token, deploy, and smoke-test sign-in, document listing, preview, and download before allowing writes.
`;

const writeBundleMetadata = async (
  bundleDir: string,
  manifest: readonly BlobManifestItem[],
  metadata: BackupMetadata,
  indexText: string,
): Promise<void> => {
  await writeFile(join(bundleDir, 'blobs-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(bundleDir, 'backup.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(join(bundleDir, 'INDEX.txt'), indexText);
  await writeFile(join(bundleDir, 'RESTORE.txt'), restoreText);

  const files = (await listFiles(bundleDir)).filter((path) => path !== 'SHA256SUMS');
  const lines: string[] = [];
  for (const path of files) {
    lines.push(`${await sha256File(join(bundleDir, ...path.split('/')))}  ${path}`);
  }
  await writeFile(join(bundleDir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
};

const createZip64 = async (bundleDir: string, archivePath: string): Promise<void> => {
  const output = await open(archivePath, 'wx');
  try {
    // Streaming output makes Info-ZIP emit ZIP64 records even while the archive is still small.
    await runCommand('zip', ['-fz', '-1', '-q', '-r', '-', '.'], {
      cwd: bundleDir,
      stdoutFile: output,
    });
  } finally {
    await output.close();
  }
  await runCommand('unzip', ['-tq', archivePath]);
};

const verifyUploaded = (
  file: DriveFile,
  archiveName: string,
  archiveSize: number,
  archiveSha256: string,
): void => {
  if (
    file.name !== archiveName ||
    Number(file.size) !== archiveSize ||
    file.appProperties?.['archiveSha256'] !== archiveSha256 ||
    file.appProperties?.['formatVersion'] !== FORMAT_VERSION.toString()
  ) {
    throw new Error('Uploaded Drive backup metadata verification failed');
  }
};

const pruneDriveBackups = async (
  drive: DriveClient,
  files: readonly DriveFile[],
): Promise<number> => {
  const selection = selectRetention(files);
  let removed = 0;
  for (const id of selection.deleteIds) {
    await drive.trash(id);
    removed += 1;
  }
  return removed;
};

const assertDirectDatabaseUrl = (databaseUrl: string): void => {
  const url = new URL(databaseUrl);
  if (!url.protocol.startsWith('postgres') || url.hostname.includes('-pooler')) {
    throw new Error('NEON_DATABASE_URL_UNPOOLED must be a direct PostgreSQL connection string');
  }
};

const main = async (): Promise<void> => {
  const env: BackupEnv = backupEnvSchema.parse(process.env);
  assertDirectDatabaseUrl(env.NEON_DATABASE_URL_UNPOOLED);
  const startedAt = new Date();
  const database = await databaseDetails(env.NEON_DATABASE_URL_UNPOOLED);
  if (database.sizeBytes > env.BACKUP_DATABASE_DAILY_MAX_BYTES) {
    process.stdout.write(
      `WARNING: backup skipped because database size ${database.sizeBytes} bytes exceeds the daily egress guard ${env.BACKUP_DATABASE_DAILY_MAX_BYTES} bytes. Switch the workflow to weekly or upgrade Neon before retrying.\n`,
    );
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), 'docu-signer-backup-'));
  const bundleDir = join(workDir, 'bundle');
  try {
    const google = await fetchDriveAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    process.stdout.write(`Authenticated the backup service account ${google.serviceAccount}.\n`);
    const drive = new DriveClient(google.accessToken, env.GOOGLE_DRIVE_FOLDER_ID);
    const driveFiles = await drive.listBackups();
    const ledger = await drive.transferLedger();
    const previous = await loadPreviousBackup(drive, driveFiles, workDir, bundleDir);
    const storage = createVercelBlobBackupStorage(env.BLOB_READ_WRITE_TOKEN);
    const databaseSql = join(bundleDir, 'database.sql');

    let stableInventory: readonly BlobInventoryItem[] | null = null;
    let backupIndexRows: readonly BackupIndexRow[] | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const before = await listAllBlobs(storage);
      await dumpDatabase(env.NEON_DATABASE_URL_UNPOOLED, databaseSql);
      const indexRows = await readBackupIndexRows(env.NEON_DATABASE_URL_UNPOOLED);
      const after = await listAllBlobs(storage);
      if (inventoriesMatch(before, after)) {
        stableInventory = after;
        backupIndexRows = indexRows;
        break;
      }
      if (attempt === 1) {
        process.stdout.write('Blob inventory changed during pg_dump; retrying the inventory and dump once.\n');
      }
    }
    if (!stableInventory || !backupIndexRows) throw new Error('Blob inventory changed during both pg_dump attempts');

    const diff = diffManifest(previous?.manifest ?? [], stableInventory);
    const plannedDownloadBytes = [...diff.newItems, ...diff.changedItems].reduce(
      (total, item) => total + item.sizeBytes,
      0,
    );
    const priorTransferCandidates = [
      driveTransferState(driveFiles, startedAt),
      ledger ? { month: ledger.ledger.month, bytesDownloaded: ledger.ledger.bytesDownloaded } : null,
      previous
        ? {
            month: previous.metadata.transfer.month,
            bytesDownloaded: previous.metadata.transfer.downloadedMonthToDateBytes,
          }
        : null,
    ].filter((state): state is MonthlyTransferState => state !== null);
    const priorTransfer = priorTransferCandidates.reduce<MonthlyTransferState | null>(
      (highest, state) =>
        highest === null || state.bytesDownloaded > highest.bytesDownloaded ? state : highest,
      null,
    );
    const transfer = monthlyTransferGuard(
      priorTransfer,
      startedAt,
      plannedDownloadBytes,
      env.BACKUP_BLOB_MONTHLY_DOWNLOAD_LIMIT_BYTES,
    );
    if (!transfer.allowed) {
      throw new Error(
        `Blob monthly transfer guard refused this backup: ${transfer.projectedBytes} projected bytes exceeds the ${transfer.ceilingBytes} byte ceiling`,
      );
    }
    await drive.reserveTransfer(ledger?.file.id ?? null, {
      formatVersion: FORMAT_VERSION,
      month: transfer.month,
      bytesDownloaded: transfer.projectedBytes,
      updatedAt: new Date().toISOString(),
    });
    process.stdout.write(
      `Reserved ${plannedDownloadBytes} Blob download bytes in the monthly transfer ledger.\n`,
    );

    await removeDeletedMirrorFiles(bundleDir, diff.deletedItems);
    const manifest: BlobManifestItem[] = [...diff.unchangedItems];
    for (const item of [...diff.newItems, ...diff.changedItems]) {
      manifest.push(await downloadBlob(storage, bundleDir, item));
    }
    manifest.sort((left, right) => left.pathname.localeCompare(right.pathname));

    for (const item of diff.unchangedItems) {
      const path = blobFilePath(bundleDir, item.pathname);
      const fileStat = await lstat(path);
      if (!fileStat.isFile() || fileStat.size !== item.sizeBytes || (await sha256File(path)) !== item.sha256) {
        throw new Error('A reused Blob mirror file failed verification');
      }
    }

    for (const generated of ['blobs-manifest.json', 'backup.json', 'INDEX.txt', 'SHA256SUMS', 'RESTORE.txt']) {
      await rm(join(bundleDir, generated), { force: true });
    }
    const archiveName = formatArchiveName(startedAt);
    const completedAt = new Date();
    const metadata: BackupMetadata = {
      formatVersion: FORMAT_VERSION,
      archiveName,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      database,
      blobs: {
        count: manifest.length,
        totalBytes: manifest.reduce((total, item) => total + item.sizeBytes, 0),
        downloadedThisRunBytes: plannedDownloadBytes,
        reusedFromPrevious: diff.unchangedItems.length,
      },
      transfer: {
        month: transfer.month,
        downloadedMonthToDateBytes: transfer.projectedBytes,
        monthlyCeilingBytes: transfer.ceilingBytes,
      },
    };
    await writeBundleMetadata(bundleDir, manifest, metadata, renderBackupIndex(backupIndexRows, manifest));

    const archivePath = join(workDir, archiveName);
    await createZip64(bundleDir, archivePath);
    const archiveStat = await stat(archivePath);
    const archiveSha256 = await sha256File(archivePath);
    const uploaded = await drive.upload(
      archivePath,
      archiveName,
      archiveStat.size,
      archiveSha256,
      { month: transfer.month, bytesDownloaded: transfer.projectedBytes },
    );
    verifyUploaded(uploaded, archiveName, archiveStat.size, archiveSha256);
    const verified = await drive.metadata(uploaded.id);
    verifyUploaded(verified, archiveName, archiveStat.size, archiveSha256);
    process.stdout.write(`Drive upload verified: ${archiveName} (${archiveStat.size} bytes).\n`);

    const currentDriveFiles = await drive.listBackups();
    const pruned = await pruneDriveBackups(drive, currentDriveFiles);
    process.stdout.write(
      `Backup complete: ${manifest.length} blobs, ${plannedDownloadBytes} Blob bytes downloaded, ${pruned} old backup(s) moved to trash.\n`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Backup failed: ${message}\n`);
    process.exitCode = 1;
  });
}
