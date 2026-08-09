import { ApiError } from '#core/client/index.js';
import { z } from 'zod';
import {
  type CreateDocument,
  type DocumentFile,
  type DocumentFileRole,
  type DocumentListFilter,
  type DocumentSignatureStatus,
  type SavedSearchFilter,
  type DocumentType,
  type DocumentWithFiles,
  type UpdateDocument,
  documentSignatureStatusSchema,
  documentTypeSchema,
} from '#core/domain/index.js';
import { formatPolishDate } from '../../lib/format-date.js';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  'umowa-uod': 'Umowa UoD',
  uchwala: 'Uchwała',
  protokol: 'Protokół',
  rachunek: 'Rachunek',
  inny: 'Inny',
};

export const FILE_ROLE_LABELS: Record<DocumentFileRole, string> = {
  source: 'Źródło',
  'signed-scan': 'Podpisany skan',
  'signed-digital': 'Podpis cyfrowy',
  other: 'Inne',
};

export const FILE_ROLE_SHORT_LABELS: Record<DocumentFileRole, string> = {
  source: 'Źródło',
  'signed-scan': 'Skan',
  'signed-digital': 'Cyfrowy',
  other: 'Inne',
};

export const SIGNATURE_STATUS_LABELS: Record<DocumentSignatureStatus, string> = {
  'needs-signature': 'Do podpisania',
  signed: 'Podpisane',
};

export interface DocumentFormValues {
  title: string;
  docType: DocumentType;
  documentDate: string;
  periodStart: string;
  periodEnd: string;
  person: string;
  tags: string[];
}

export interface DocumentFilterValues {
  text: string;
  docType: DocumentType | '';
  person: string;
  tag: string;
  dateFrom: string;
  dateTo: string;
  signatureStatus: DocumentSignatureStatus | '';
  draft: 'false' | 'true' | 'all';
}

export type DocumentsView = 'list' | 'folders' | 'timeline' | 'trash';

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().catch(undefined);
const textParamSchema = z.preprocess(
  (value: unknown) => (typeof value === 'string' ? value : undefined),
  z.string().trim().min(1).optional(),
).catch(undefined);
const draftParamSchema = z.preprocess(
  (value: unknown) => (value === true ? 'true' : value),
  z.enum(['true', 'all']).optional(),
).catch(undefined);
const documentsSearchInputSchema = z.object({
  tab: z.enum(['teczki', 'os-czasu', 'kosz']).optional().catch(undefined),
  q: textParamSchema,
  typ: documentTypeSchema.optional().catch(undefined),
  osoba: textParamSchema,
  tag: textParamSchema,
  status: documentSignatureStatusSchema.optional().catch(undefined),
  szkice: draftParamSchema,
  od: dateParamSchema,
  do: dateParamSchema,
});

export const documentsSearchSchema = z.preprocess(
  (value) => (typeof value === 'object' && value !== null ? value : {}),
  documentsSearchInputSchema,
);

export type DocumentsSearchParams = z.infer<typeof documentsSearchSchema>;

export const emptyDocumentFilters = (): DocumentFilterValues => ({
  text: '',
  docType: '',
  person: '',
  tag: '',
  dateFrom: '',
  dateTo: '',
  signatureStatus: '',
  draft: 'false',
});

export const documentsViewFromSearch = (search: DocumentsSearchParams): DocumentsView => {
  if (search.tab === 'teczki') return 'folders';
  if (search.tab === 'os-czasu') return 'timeline';
  if (search.tab === 'kosz') return 'trash';
  return 'list';
};

export const documentFiltersFromSearch = (
  search: DocumentsSearchParams,
): DocumentFilterValues => ({
  text: search.q ?? '',
  docType: search.typ ?? '',
  person: search.osoba ?? '',
  tag: search.tag ?? '',
  dateFrom: search.od ?? '',
  dateTo: search.do ?? '',
  signatureStatus: search.status ?? '',
  draft: search.szkice ?? 'false',
});

export const documentsSearchFromState = (
  view: DocumentsView,
  values: DocumentFilterValues,
): DocumentsSearchParams => ({
  ...(view === 'folders' ? { tab: 'teczki' as const } : {}),
  ...(view === 'timeline' ? { tab: 'os-czasu' as const } : {}),
  ...(view === 'trash' ? { tab: 'kosz' as const } : {}),
  ...(values.text.trim() ? { q: values.text.trim() } : {}),
  ...(values.docType ? { typ: values.docType } : {}),
  ...(values.person.trim() ? { osoba: values.person.trim() } : {}),
  ...(values.tag.trim() ? { tag: values.tag.trim() } : {}),
  ...(values.signatureStatus ? { status: values.signatureStatus } : {}),
  ...(values.draft === 'false' ? {} : { szkice: values.draft }),
  ...(values.dateFrom ? { od: values.dateFrom } : {}),
  ...(values.dateTo ? { do: values.dateTo } : {}),
});

export const emptyDocumentForm = (): DocumentFormValues => ({
  title: '',
  docType: 'umowa-uod',
  documentDate: '',
  periodStart: '',
  periodEnd: '',
  person: '',
  tags: [],
});

export const toDocumentInput = (
  values: DocumentFormValues,
): CreateDocument | UpdateDocument => ({
  title: values.title.trim(),
  docType: values.docType,
  documentDate: values.documentDate,
  periodStart: values.periodStart || null,
  periodEnd: values.periodEnd || null,
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  tags: Array.from(new Set(values.tags.map((tag) => tag.trim()).filter(Boolean))),
});

export const suggestDocumentDate = (
  values: DocumentFormValues,
  changedField: 'periodStart' | 'periodEnd',
  changedValue: string,
): DocumentFormValues => {
  const next = { ...values, [changedField]: changedValue };
  if (next.documentDate) return next;
  if (next.docType === 'umowa-uod' && changedField === 'periodStart') {
    return { ...next, documentDate: changedValue };
  }
  if (next.docType === 'protokol' && changedField === 'periodEnd') {
    return { ...next, documentDate: changedValue };
  }
  return next;
};

export const toDocumentFilter = (values: {
  text: string;
  docType: DocumentType | '';
  person: string;
  tag: string;
  dateFrom: string;
  dateTo: string;
  signatureStatus: DocumentSignatureStatus | '';
  draft: 'false' | 'true' | 'all';
}): DocumentListFilter => ({
  ...(values.text.trim() ? { text: values.text.trim() } : {}),
  ...(values.docType ? { docType: values.docType } : {}),
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  ...(values.tag.trim() ? { tag: values.tag.trim() } : {}),
  ...(values.dateFrom ? { dateFrom: values.dateFrom } : {}),
  ...(values.dateTo ? { dateTo: values.dateTo } : {}),
  ...(values.signatureStatus ? { signatureStatus: values.signatureStatus } : {}),
  ...(values.draft === 'false' ? {} : { draft: values.draft }),
});

export const toDocumentFilterValues = (filter: SavedSearchFilter): DocumentFilterValues => ({
  text: filter.text ?? '',
  docType: filter.docType ?? '',
  person: filter.person ?? '',
  tag: filter.tag ?? '',
  dateFrom: filter.dateFrom ?? '',
  dateTo: filter.dateTo ?? '',
  signatureStatus: filter.signatureStatus ?? '',
  draft: filter.draft ?? 'false',
});

export const hasDocumentFilter = (filter: DocumentListFilter): boolean =>
  Object.values(filter).some((value) => value !== undefined && value.length > 0);

export const hasSignedDocumentFile = (
  document: Pick<DocumentWithFiles, 'files'>,
): boolean =>
  document.files.some((file) => file.role === 'signed-scan' || file.role === 'signed-digital');

export const documentFilterSummary = (filter: SavedSearchFilter): string => {
  const parts = [
    filter.text ? `Tytuł: ${filter.text}` : '',
    filter.docType ? `Typ: ${DOCUMENT_TYPE_LABELS[filter.docType]}` : '',
    filter.person ? `Osoba: ${filter.person}` : '',
    filter.tag ? `Tag: ${filter.tag}` : '',
    filter.dateFrom ? `Od: ${formatPolishDate(filter.dateFrom)}` : '',
    filter.dateTo ? `Do: ${formatPolishDate(filter.dateTo)}` : '',
    filter.signatureStatus
      ? `Status podpisu: ${SIGNATURE_STATUS_LABELS[filter.signatureStatus]}`
      : '',
    filter.draft === 'true' ? 'Szkice: tylko szkice' : '',
    filter.draft === 'all' ? 'Szkice: razem z zatwierdzonymi' : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Wszystkie dokumenty';
};

export const uniqueDocumentPersons = (
  documents: Array<Pick<DocumentWithFiles, 'person'>>,
): string[] =>
  Array.from(
    new Set(
      documents
        .map((document) => document.person?.trim())
        .filter((person): person is string => Boolean(person)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pl'));

export const uniqueDocumentTags = (
  documents: Array<Pick<DocumentWithFiles, 'tags'>>,
): string[] =>
  Array.from(new Set(documents.flatMap((document) => document.tags))).sort((left, right) =>
    left.localeCompare(right, 'pl'),
  );

export const fileNameStem = (fileName: string): string => {
  const trimmed = fileName.trim();
  const dot = trimmed.lastIndexOf('.');
  return dot > 0 ? trimmed.slice(0, dot) : trimmed;
};

export const filesByRole = (
  files: DocumentFile[],
): Record<DocumentFileRole, DocumentFile[]> => ({
  source: files.filter((file) => file.role === 'source'),
  'signed-scan': files.filter((file) => file.role === 'signed-scan'),
  'signed-digital': files.filter((file) => file.role === 'signed-digital'),
  other: files.filter((file) => file.role === 'other'),
});

export const canSignPdfFile = (
  file: Pick<DocumentFile, 'role' | 'contentType'>,
): boolean =>
  (file.role === 'source' || file.role === 'signed-digital') &&
  file.contentType.toLowerCase() === 'application/pdf';

export interface TimelineInterval {
  start: string;
  end: string;
}

export interface TimelineDocument extends TimelineInterval {
  id: string;
  title: string;
  docType: DocumentType;
  instant: boolean;
  signed: boolean;
}

export interface TimelineGroup {
  person: string;
  intervals: TimelineInterval[];
  documents: TimelineDocument[];
}

export interface TimelineScale {
  start: string;
  end: string;
  width: number;
  x: (date: string) => number;
}

export interface TimelineTick {
  date: string;
  label: string;
  year: string;
}

type TimelineDocumentInput = Pick<
  DocumentWithFiles,
  'id' | 'title' | 'docType' | 'documentDate' | 'periodStart' | 'periodEnd' | 'person' | 'files'
>;

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMELINE_MIN_WIDTH = 720;
const TIMELINE_DAY_WIDTH = 3.2;

const dateMs = (date: string): number => {
  const parts = date.split('-').map((part) => Number(part));
  const year = parts.at(0) ?? 0;
  const month = parts.at(1) ?? 1;
  const day = parts.at(2) ?? 1;
  return Date.UTC(year, month - 1, day);
};

const isoDateFromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const startOfMonth = (date: string): string => {
  const parts = date.split('-').map((part) => Number(part));
  const year = parts.at(0) ?? 0;
  const month = parts.at(1) ?? 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
};

const addMonths = (date: string, months: number): string => {
  const parts = date.split('-').map((part) => Number(part));
  const year = parts.at(0) ?? 0;
  const month = parts.at(1) ?? 1;
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
};

const normalizeInterval = (start: string, end: string): TimelineInterval =>
  start <= end ? { start, end } : { start: end, end: start };

export const timelineIntervalForDocument = (
  document: TimelineDocumentInput,
): TimelineDocument => {
  const interval = normalizeInterval(
    document.periodStart ?? document.documentDate,
    document.periodEnd ?? document.documentDate,
  );
  return {
    ...interval,
    id: document.id,
    title: document.title,
    docType: document.docType,
    instant: document.periodStart === null && document.periodEnd === null,
    signed: hasSignedDocumentFile(document),
  };
};

export const unionTimelineIntervals = (
  intervals: TimelineInterval[],
): TimelineInterval[] => {
  const sorted = [...intervals].sort((left, right) =>
    left.start === right.start ? left.end.localeCompare(right.end) : left.start.localeCompare(right.start),
  );
  const merged: TimelineInterval[] = [];
  for (const interval of sorted) {
    const current = merged.at(-1);
    if (!current || dateMs(interval.start) > dateMs(current.end)) {
      merged.push({ ...interval });
    } else if (interval.end > current.end) {
      current.end = interval.end;
    }
  }
  return merged;
};

export const groupDocumentsForTimeline = (
  documents: TimelineDocumentInput[],
): TimelineGroup[] => {
  const buckets = new Map<string, TimelineDocument[]>();
  for (const document of documents) {
    const person = document.person?.trim() || 'Bez osoby';
    const current = buckets.get(person) ?? [];
    current.push(timelineIntervalForDocument(document));
    buckets.set(person, current);
  }
  return Array.from(buckets.entries())
    .map(([person, items]) => {
      const documentsForPerson = [...items].sort((left, right) =>
        left.start === right.start
          ? left.title.localeCompare(right.title, 'pl')
          : left.start.localeCompare(right.start),
      );
      return {
        person,
        intervals: unionTimelineIntervals(documentsForPerson),
        documents: documentsForPerson,
      };
    })
    .sort((left, right) => left.person.localeCompare(right.person, 'pl'));
};

export const createTimelineScale = (
  intervals: TimelineInterval[],
  minWidth = TIMELINE_MIN_WIDTH,
): TimelineScale => {
  if (intervals.length === 0) {
    return {
      start: '1970-01-01',
      end: '1970-01-01',
      width: minWidth,
      x: () => 0,
    };
  }
  const starts = intervals.map((interval) => dateMs(interval.start));
  const ends = intervals.map((interval) => dateMs(interval.end));
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const spanDays = Math.max(1, Math.round((max - min) / DAY_MS));
  const width = Math.max(minWidth, Math.ceil(spanDays * TIMELINE_DAY_WIDTH));
  return {
    start: isoDateFromMs(min),
    end: isoDateFromMs(max),
    width,
    x: (date: string) => ((dateMs(date) - min) / Math.max(1, max - min)) * width,
  };
};

export const timelineMonthTicks = (scale: Pick<TimelineScale, 'start' | 'end'>): TimelineTick[] => {
  const ticks: TimelineTick[] = [];
  let cursor = startOfMonth(scale.start);
  while (cursor <= scale.end) {
    const parts = cursor.split('-');
    const year = parts.at(0) ?? '';
    const month = parts.at(1) ?? '';
    ticks.push({
      date: cursor,
      label: `${month}.${year}`,
      year,
    });
    cursor = addMonths(cursor, 1);
  }
  return ticks;
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const uploadErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) {
    const messages = {
      unauthorized: 'Sesja wygasła. Zaloguj się ponownie.',
      forbidden: 'Nie masz uprawnień do wgrania tego pliku.',
      not_found: 'Dokument lub plik nie został znaleziony.',
      validation: 'Plik ma nieprawidłowe dane.',
      conflict: 'Ten plik jest w konflikcie z istniejącymi danymi.',
      export_too_large: 'Eksport przekracza dozwolony rozmiar.',
      tenant_not_found: 'Nie wybrano organizacji.',
      unavailable: 'Magazyn plików jest chwilowo niedostępny.',
      internal: 'Nie udało się wgrać pliku. Spróbuj ponownie.',
    };
    return messages[error.appError.code];
  }
  return error instanceof Error ? error.message : 'Nie udało się wgrać pliku.';
};
