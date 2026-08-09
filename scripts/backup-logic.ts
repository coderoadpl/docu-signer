export interface BlobInventoryItem {
  readonly pathname: string;
  readonly etag: string;
  readonly sizeBytes: number;
}

export interface BlobManifestItem extends BlobInventoryItem {
  readonly contentType: string;
  readonly sha256: string;
}

export interface ManifestDiff {
  readonly newItems: readonly BlobInventoryItem[];
  readonly changedItems: readonly BlobInventoryItem[];
  readonly deletedItems: readonly BlobManifestItem[];
  readonly unchangedItems: readonly BlobManifestItem[];
}

const inventoryMap = <T extends BlobInventoryItem>(items: readonly T[]): Map<string, T> => {
  const byPath = new Map<string, T>();
  for (const item of items) {
    if (byPath.has(item.pathname)) throw new Error('Duplicate blob pathname in inventory');
    byPath.set(item.pathname, item);
  }
  return byPath;
};

const byPathname = <T extends BlobInventoryItem>(left: T, right: T): number =>
  left.pathname.localeCompare(right.pathname);

export const diffManifest = (
  previous: readonly BlobManifestItem[],
  current: readonly BlobInventoryItem[],
): ManifestDiff => {
  const previousByPath = inventoryMap(previous);
  const currentByPath = inventoryMap(current);
  const newItems: BlobInventoryItem[] = [];
  const changedItems: BlobInventoryItem[] = [];
  const unchangedItems: BlobManifestItem[] = [];
  const deletedItems: BlobManifestItem[] = [];

  for (const item of current) {
    const old = previousByPath.get(item.pathname);
    if (!old) {
      newItems.push(item);
    } else if (old.etag !== item.etag || old.sizeBytes !== item.sizeBytes) {
      changedItems.push(item);
    } else {
      unchangedItems.push(old);
    }
  }
  for (const item of previous) {
    if (!currentByPath.has(item.pathname)) deletedItems.push(item);
  }

  return {
    newItems: newItems.sort(byPathname),
    changedItems: changedItems.sort(byPathname),
    deletedItems: deletedItems.sort(byPathname),
    unchangedItems: unchangedItems.sort(byPathname),
  };
};

export const inventoriesMatch = (
  left: readonly BlobInventoryItem[],
  right: readonly BlobInventoryItem[],
): boolean => {
  if (left.length !== right.length) return false;
  const rightByPath = inventoryMap(right);
  return left.every((item) => {
    const other = rightByPath.get(item.pathname);
    return other?.etag === item.etag && other.sizeBytes === item.sizeBytes;
  });
};

const directDatabaseUrlError = 'NEON_DATABASE_URL_UNPOOLED must be a direct PostgreSQL connection string';

const requiredUrlPart = (value: string): string => {
  if (value.length === 0) throw new Error(directDatabaseUrlError);
  return decodeURIComponent(value);
};

export interface PgDatabaseEnv extends Record<string, string> {
  readonly PGHOST: string;
  readonly PGPORT: string;
  readonly PGDATABASE: string;
  readonly PGUSER: string;
  readonly PGPASSWORD: string;
}

export const pgEnvFromDatabaseUrl = (databaseUrl: string): PgDatabaseEnv => {
  const url = new URL(databaseUrl);
  if (!url.protocol.startsWith('postgres') || url.hostname.includes('-pooler')) {
    throw new Error(directDatabaseUrlError);
  }
  const databaseName = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  const env: PgDatabaseEnv = {
    PGHOST: requiredUrlPart(url.hostname),
    PGPORT: url.port.length === 0 ? '5432' : url.port,
    PGDATABASE: requiredUrlPart(databaseName),
    PGUSER: requiredUrlPart(url.username),
    PGPASSWORD: requiredUrlPart(url.password),
  };
  if (url.searchParams.has('sslmode')) {
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode !== null) env['PGSSLMODE'] = sslmode;
  }
  if (url.searchParams.has('channel_binding')) {
    const channelBinding = url.searchParams.get('channel_binding');
    if (channelBinding !== null) env['PGCHANNELBINDING'] = channelBinding;
  }
  return env;
};

const ARCHIVE_PATTERN =
  /^docu-signer-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.zip$/;

export const parseArchiveName = (name: string): Date | null => {
  const match = ARCHIVE_PATTERN.exec(name);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  const hour = parts[3];
  const minute = parts[4];
  const second = parts[5];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
    ? date
    : null;
};

const twoDigits = (value: number): string => value.toString().padStart(2, '0');

export const formatArchiveName = (date: Date): string =>
  `docu-signer-backup-${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(date.getUTCDate())}T${twoDigits(date.getUTCHours())}-${twoDigits(date.getUTCMinutes())}-${twoDigits(date.getUTCSeconds())}Z.zip`;

export interface RetentionFile {
  readonly id: string;
  readonly name: string;
}

export interface RetentionSelection {
  readonly keepIds: ReadonlySet<string>;
  readonly deleteIds: ReadonlySet<string>;
}

interface ParsedRetentionFile extends RetentionFile {
  readonly timestamp: Date;
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

const utcWeek = (date: Date): string => {
  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return utcDay(monday);
};

export const selectRetention = (files: readonly RetentionFile[]): RetentionSelection => {
  const parsed: ParsedRetentionFile[] = [];
  for (const file of files) {
    const timestamp = parseArchiveName(file.name);
    if (timestamp) parsed.push({ ...file, timestamp });
  }
  parsed.sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

  const keepIds = new Set<string>();
  const dailyDates = new Set<string>();
  for (const file of parsed) {
    const day = utcDay(file.timestamp);
    if (dailyDates.has(day)) continue;
    dailyDates.add(day);
    keepIds.add(file.id);
    if (dailyDates.size === 7) break;
  }

  const byWeek = new Map<string, ParsedRetentionFile[]>();
  for (const file of parsed) {
    const week = utcWeek(file.timestamp);
    const entries = byWeek.get(week) ?? [];
    entries.push(file);
    byWeek.set(week, entries);
  }
  const weeks = [...byWeek.keys()].sort().reverse().slice(0, 4);
  for (const week of weeks) {
    const entries = byWeek.get(week);
    if (!entries) continue;
    entries.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    const weekly = entries.find((file) => file.timestamp.getUTCDay() === 0) ?? entries[0];
    if (weekly) keepIds.add(weekly.id);
  }

  return {
    keepIds,
    deleteIds: new Set(parsed.filter((file) => !keepIds.has(file.id)).map((file) => file.id)),
  };
};

export interface MonthlyTransferState {
  readonly month: string;
  readonly bytesDownloaded: number;
}

export interface MonthlyTransferDecision {
  readonly month: string;
  readonly priorBytes: number;
  readonly projectedBytes: number;
  readonly ceilingBytes: number;
  readonly allowed: boolean;
}

export const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

export const monthlyTransferGuard = (
  previous: MonthlyTransferState | null,
  runAt: Date,
  plannedBytes: number,
  ceilingBytes: number,
): MonthlyTransferDecision => {
  if (!Number.isSafeInteger(plannedBytes) || plannedBytes < 0) {
    throw new Error('Planned transfer must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(ceilingBytes) || ceilingBytes < 0) {
    throw new Error('Transfer ceiling must be a non-negative safe integer');
  }
  const month = monthKey(runAt);
  const priorBytes = previous?.month === month ? previous.bytesDownloaded : 0;
  if (!Number.isSafeInteger(priorBytes) || priorBytes < 0) {
    throw new Error('Previous transfer must be a non-negative safe integer');
  }
  const projectedBytes = priorBytes + plannedBytes;
  if (!Number.isSafeInteger(projectedBytes)) throw new Error('Projected transfer is too large');
  return {
    month,
    priorBytes,
    projectedBytes,
    ceilingBytes,
    allowed: projectedBytes <= ceilingBytes,
  };
};
