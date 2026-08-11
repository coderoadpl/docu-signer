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

export const DOCUMENT_TYPE_COLORS: Record<DocumentType, string> = {
  'umowa-uod': '#385171',
  uchwala: '#7a5c8f',
  protokol: '#2f855a',
  rachunek: '#b36b1f',
  inny: '#5a6572',
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
  signerAccountId: string;
  draft: 'false' | 'true' | 'all';
}

export type DocumentsView = 'list' | 'timeline';

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().catch(undefined);
const textParamSchema = z.preprocess(
  (value: unknown) => (typeof value === 'string' ? value : undefined),
  z.string().trim().min(1).optional(),
).catch(undefined);
const draftParamSchema = z.preprocess(
  (value: unknown) => {
    if (value === true || value === 'true' || value === '"true"') return true;
    if (value === 'all' || value === '"all"') return 'all';
    return value;
  },
  z.union([z.literal(true), z.literal('all')]).optional(),
).catch(undefined);
const documentsSearchInputSchema = z.object({
  widok: z.literal('os-czasu').optional().catch(undefined),
  q: textParamSchema,
  typ: documentTypeSchema.optional().catch(undefined),
  osoba: textParamSchema,
  tag: textParamSchema,
  status: documentSignatureStatusSchema.optional().catch(undefined),
  podpisal: textParamSchema,
  szkice: draftParamSchema,
  od: dateParamSchema,
  do: dateParamSchema,
  podpisano: z.coerce.number().int().nonnegative().optional().catch(undefined),
  razem: z.coerce.number().int().positive().optional().catch(undefined),
});

export const documentsSearchSchema = z.preprocess(
  (value) => (typeof value === 'object' && value !== null ? value : {}),
  documentsSearchInputSchema,
);

export type DocumentsSearchParams = z.infer<typeof documentsSearchSchema>;

const queueParamSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .catch(undefined);
const trueParamSchema = z.preprocess(
  (value: unknown) => (value === true || value === 'true' ? true : undefined),
  z.literal(true).optional(),
).catch(undefined);

export const documentSigningSearchSchema = z.preprocess(
  (value) => (typeof value === 'object' && value !== null ? value : {}),
  documentsSearchInputSchema.extend({
    kolejka: queueParamSchema,
    pliki: queueParamSchema,
    tryb: z.enum(['masowe']).optional().catch(undefined),
    pominiete: z.coerce.number().int().nonnegative().optional().catch(undefined),
    podpisane: z.coerce.number().int().nonnegative().optional().catch(undefined),
    koniec: trueParamSchema,
  }),
);

export type DocumentSigningSearchParams = z.infer<typeof documentSigningSearchSchema>;

export const documentReviewSearchSchema = z.preprocess(
  (value) => (typeof value === 'object' && value !== null ? value : {}),
  documentsSearchInputSchema.extend({
    kolejka: queueParamSchema,
    tryb: z.enum(['zrodlo', 'podpisany', 'edycja']).optional().catch(undefined),
  }),
);

export type DocumentReviewSearchParams = z.infer<typeof documentReviewSearchSchema>;
export type DocumentReviewMode = 'source' | 'signed' | 'edit';

export const emptyDocumentFilters = (): DocumentFilterValues => ({
  text: '',
  docType: '',
  person: '',
  tag: '',
  dateFrom: '',
  dateTo: '',
  signatureStatus: '',
  signerAccountId: '',
  draft: 'false',
});

export const documentsViewFromSearch = (search: DocumentsSearchParams): DocumentsView => {
  return search.widok === 'os-czasu' ? 'timeline' : 'list';
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
  signerAccountId: search.podpisal ?? '',
  draft: search.szkice === true ? 'true' : search.szkice ?? 'false',
});

export const documentsSearchFromState = (
  view: DocumentsView,
  values: DocumentFilterValues,
): DocumentsSearchParams => ({
  ...(view === 'timeline' ? { widok: 'os-czasu' as const } : {}),
  ...(values.text.trim() ? { q: values.text.trim() } : {}),
  ...(values.docType ? { typ: values.docType } : {}),
  ...(values.person.trim() ? { osoba: values.person.trim() } : {}),
  ...(values.tag.trim() ? { tag: values.tag.trim() } : {}),
  ...(values.signatureStatus ? { status: values.signatureStatus } : {}),
  ...(values.signerAccountId ? { podpisal: values.signerAccountId } : {}),
  ...(values.draft === 'true' ? { szkice: true as const } : {}),
  ...(values.draft === 'all' ? { szkice: 'all' as const } : {}),
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
  signerAccountId: string;
  draft: 'false' | 'true' | 'all';
}): DocumentListFilter => ({
  ...(values.text.trim() ? { text: values.text.trim() } : {}),
  ...(values.docType ? { docType: values.docType } : {}),
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  ...(values.tag.trim() ? { tag: values.tag.trim() } : {}),
  ...(values.dateFrom ? { dateFrom: values.dateFrom } : {}),
  ...(values.dateTo ? { dateTo: values.dateTo } : {}),
  ...(values.signatureStatus ? { signatureStatus: values.signatureStatus } : {}),
  ...(values.signerAccountId.trim()
    ? { signerAccountId: values.signerAccountId.trim() }
    : {}),
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
  signerAccountId: filter.signerAccountId ?? '',
  draft: filter.draft ?? 'false',
});

export const hasDocumentFilter = (filter: DocumentListFilter): boolean =>
  Object.values(filter).some((value) => value !== undefined && value.length > 0);

export const hasSignedDocumentFile = (
  document: Pick<DocumentWithFiles, 'files'>,
): boolean =>
  document.files.some((file) => file.role === 'signed-scan' || file.role === 'signed-digital');

export interface CanonicalDocumentInterval {
  start: string;
  end: string;
}

export interface CanonicalDocumentPersonGroup<
  Document extends CanonicalGroupedDocumentInput,
> {
  person: string;
  documents: Document[];
}

export interface CanonicalDocumentPeriodGroup<
  Document extends CanonicalGroupedDocumentInput,
> extends CanonicalDocumentInterval {
  people: Array<CanonicalDocumentPersonGroup<Document>>;
}

export type CanonicalGroupedDocumentInput = Pick<
  DocumentWithFiles,
  'docType' | 'documentDate' | 'periodStart' | 'periodEnd' | 'person'
>;

const DOC_TYPE_PRECEDENCE: Partial<Record<DocumentType, number>> = {
  'umowa-uod': 0,
  protokol: 1,
  rachunek: 2,
};

const personGroupLabel = (person: string | null | undefined): string =>
  person?.trim() || 'Bez osoby';

const comparePersonLabels = (left: string, right: string): number => {
  if (left === right) return 0;
  if (left === 'Bez osoby') return 1;
  if (right === 'Bez osoby') return -1;
  return left.localeCompare(right, 'pl');
};

export const canonicalDocumentInterval = (
  document: Pick<CanonicalGroupedDocumentInput, 'documentDate' | 'periodStart' | 'periodEnd'>,
): CanonicalDocumentInterval =>
  normalizeInterval(
    document.periodStart ?? document.documentDate,
    document.periodEnd ?? document.documentDate,
  );

export const formatCanonicalDocumentInterval = (
  interval: CanonicalDocumentInterval,
): string =>
  interval.start === interval.end
    ? formatPolishDate(interval.start)
    : `${formatPolishDate(interval.start)}-${formatPolishDate(interval.end)}`;

export const groupDocumentsCanonically = <
  Document extends CanonicalGroupedDocumentInput,
>(
  documents: Document[],
): Array<CanonicalDocumentPeriodGroup<Document>> => {
  const periodBuckets = new Map<string, {
    interval: CanonicalDocumentInterval;
    documents: Array<{ document: Document; index: number }>;
  }>();
  for (const [index, document] of documents.entries()) {
    const interval = canonicalDocumentInterval(document);
    const key = `${interval.start}|${interval.end}`;
    const bucket = periodBuckets.get(key);
    if (bucket) {
      bucket.documents.push({ document, index });
    } else {
      periodBuckets.set(key, { interval, documents: [{ document, index }] });
    }
  }

  return Array.from(periodBuckets.values())
    .sort((left, right) =>
      left.interval.start === right.interval.start
        ? left.interval.end.localeCompare(right.interval.end)
        : left.interval.start.localeCompare(right.interval.start),
    )
    .map(({ interval, documents: periodDocuments }) => {
      const personBuckets = new Map<string, Array<{ document: Document; index: number }>>();
      for (const item of periodDocuments) {
        const person = personGroupLabel(item.document.person);
        const bucket = personBuckets.get(person) ?? [];
        bucket.push(item);
        personBuckets.set(person, bucket);
      }
      return {
        ...interval,
        people: Array.from(personBuckets.entries())
          .sort(([left], [right]) => comparePersonLabels(left, right))
          .map(([person, items]) => ({
            person,
            documents: [...items]
              .sort((left, right) => {
                const leftPrecedence = DOC_TYPE_PRECEDENCE[left.document.docType];
                const rightPrecedence = DOC_TYPE_PRECEDENCE[right.document.docType];
                if (leftPrecedence !== undefined || rightPrecedence !== undefined) {
                  return (leftPrecedence ?? 3) - (rightPrecedence ?? 3) || left.index - right.index;
                }
                return left.index - right.index;
              })
              .map((item) => item.document),
          })),
      };
    });
};

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
    filter.signerAccountId ? `Podpisał(a): ${filter.signerAccountId}` : '',
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

export interface SigningQueueTarget {
  documentId: string;
  fileId: string;
}

const commaParts = (value: string | undefined): string[] =>
  value ? value.split(',').map((part) => part.trim()).filter(Boolean) : [];

const newestFileFirst = (
  left: Pick<DocumentFile, 'createdAt'>,
  right: Pick<DocumentFile, 'createdAt'>,
): number => right.createdAt.localeCompare(left.createdAt);

export const newestSignablePdfFile = (
  document: Pick<DocumentWithFiles, 'files'>,
): DocumentFile | undefined => {
  const signableFiles = document.files.filter(canSignPdfFile);
  const signedDigital = signableFiles
    .filter((file) => file.role === 'signed-digital')
    .sort(newestFileFirst);
  const source = signableFiles
    .filter((file) => file.role === 'source')
    .sort(newestFileFirst);
  return signedDigital[0] ?? source[0];
};

export const newestDocumentFileByRole = (
  document: Pick<DocumentWithFiles, 'files'>,
  role: 'source' | 'signed-digital',
): DocumentFile | undefined =>
  document.files.filter((file) => file.role === role).sort(newestFileFirst)[0];

const documentsInCanonicalOrder = <Document extends CanonicalGroupedDocumentInput>(
  documents: Document[],
): Document[] =>
  groupDocumentsCanonically(documents)
    .flatMap((periodGroup) => periodGroup.people)
    .flatMap((personGroup) => personGroup.documents);

export const massSigningQueueTargets = (
  documents: DocumentWithFiles[],
): SigningQueueTarget[] =>
  documentsInCanonicalOrder(documents)
    .flatMap((document) => {
      const file = newestSignablePdfFile(document);
      return file ? [{ documentId: document.id, fileId: file.id }] : [];
    });

export const massReviewQueueDocumentIds = (
  documents: DocumentWithFiles[],
): string[] => documentsInCanonicalOrder(documents).map((document) => document.id);

export const massReviewQueueSearch = (
  documentIds: string[],
): Pick<DocumentReviewSearchParams, 'kolejka'> => ({
  kolejka: documentIds.join(','),
});

export const reviewQueueFromSearch = (
  search: Pick<DocumentReviewSearchParams, 'kolejka'>,
): string[] => Array.from(new Set(commaParts(search.kolejka)));

export const reviewModeFromSearch = (
  search: Pick<DocumentReviewSearchParams, 'tryb'>,
): DocumentReviewMode =>
  search.tryb === 'podpisany' ? 'signed' : search.tryb === 'edycja' ? 'edit' : 'source';

export const signingQueueSearch = ({
  signedCount,
  targets,
  total,
}: {
  signedCount: number;
  targets: SigningQueueTarget[];
  total: number;
}): Pick<DocumentSigningSearchParams, 'kolejka' | 'pliki' | 'podpisane' | 'razem'> => ({
  ...(targets.length > 0
    ? {
        kolejka: targets.map((target) => target.documentId).join(','),
        pliki: targets.map((target) => target.fileId).join(','),
      }
    : {}),
  podpisane: signedCount,
  razem: total,
});

export const massSigningQueueSearch = ({
  signedCount,
  skippedCount,
  targets,
  total,
}: {
  signedCount: number;
  skippedCount: number;
  targets: SigningQueueTarget[];
  total: number;
}): Pick<
  DocumentSigningSearchParams,
  'tryb' | 'kolejka' | 'pliki' | 'podpisane' | 'pominiete' | 'razem'
> => ({
  tryb: 'masowe',
  ...signingQueueSearch({ signedCount, targets, total }),
  pominiete: skippedCount,
});

export const signingQueueFromSearch = (
  search: Pick<DocumentSigningSearchParams, 'kolejka' | 'pliki'>,
): SigningQueueTarget[] => {
  const documentIds = commaParts(search.kolejka);
  const fileIds = commaParts(search.pliki);
  if (documentIds.length === 0 || documentIds.length !== fileIds.length) return [];
  return documentIds.map((documentId, index) => ({
    documentId,
    fileId: fileIds[index] ?? '',
  })).filter((target) => target.fileId);
};

export const documentsSearchFromSigningSearch = (
  search: DocumentSigningSearchParams,
): DocumentsSearchParams =>
  documentsSearchSchema.parse({
    widok: search.widok,
    q: search.q,
    typ: search.typ,
    osoba: search.osoba,
    tag: search.tag,
    status: search.status,
    podpisal: search.podpisal,
    szkice: search.szkice,
    od: search.od,
    do: search.do,
  });

export const documentsSearchFromReviewSearch = (
  search: DocumentReviewSearchParams,
): DocumentsSearchParams =>
  documentsSearchSchema.parse({
    widok: search.widok,
    q: search.q,
    typ: search.typ,
    osoba: search.osoba,
    tag: search.tag,
    status: search.status,
    podpisal: search.podpisal,
    szkice: search.szkice,
    od: search.od,
    do: search.do,
  });

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

export interface VisTimelineItem {
  id: string;
  group: string;
  start: string;
  end?: string;
  type: 'point' | 'range';
  content: string;
  className: string;
  title: string;
}

export interface VisTimelineGroup {
  id: string;
  content: string;
}

type TimelineDocumentInput = Pick<
  DocumentWithFiles,
  'id' | 'title' | 'docType' | 'documentDate' | 'periodStart' | 'periodEnd' | 'person' | 'files'
>;

const dateMs = (date: string): number => {
  const parts = date.split('-').map((part) => Number(part));
  const year = parts.at(0) ?? 0;
  const month = parts.at(1) ?? 1;
  const day = parts.at(2) ?? 1;
  return Date.UTC(year, month - 1, day);
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

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const timelineDocumentTooltip = (document: TimelineDocument): string => {
  const dates = document.instant
    ? formatPolishDate(document.start)
    : `${formatPolishDate(document.start)} - ${formatPolishDate(document.end)}`;
  return `${escapeHtml(document.title)}\n${DOCUMENT_TYPE_LABELS[document.docType]}\n${dates}\n${
    SIGNATURE_STATUS_LABELS[document.signed ? 'signed' : 'needs-signature']
  }`;
};

export const toVisTimelineData = (
  timelineGroups: TimelineGroup[],
): { items: VisTimelineItem[]; groups: VisTimelineGroup[] } => {
  const groups = [...timelineGroups].sort((left, right) =>
    left.person.localeCompare(right.person, 'pl'),
  );
  return {
    groups: groups.map(({ person }) => ({ id: person, content: escapeHtml(person) })),
    items: groups.flatMap((group) =>
      group.documents.map((document) => ({
        id: document.id,
        group: group.person,
        start: document.start,
        ...(document.instant ? {} : { end: document.end }),
        type: document.instant ? 'point' : 'range',
        // WHY bare spans: vis-timeline sanitizes item HTML and drops every
        // attribute, so the mark and the title are addressed structurally.
        content: `<span>${document.signed ? '✓' : '○'}</span><span>${escapeHtml(
          document.title,
        )}</span>`,
        className: `doc doc--${document.docType} ${
          document.signed ? 'is-signed' : 'is-unsigned'
        }`,
        title: timelineDocumentTooltip(document),
      })),
    ),
  };
};

const DAY_MS = 86_400_000;
const LABEL_BUDGET_PX = 320;

export const visTimelineFittedWindow = (
  items: Pick<VisTimelineItem, 'start' | 'end'>[],
  viewportWidth: number,
): { start: Date; end: Date } | null => {
  if (items.length === 0) return null;
  const starts = items.map((item) => dateMs(item.start));
  const first = Math.min(...starts);
  const lastStart = Math.max(...starts);
  const lastEnd = Math.max(...items.map((item) => dateMs(item.end ?? item.start)));
  const start = first - Math.max((lastEnd - first) * 0.05, 7 * DAY_MS);
  // WHY the viewport takes part in the maths: a title is drawn from its item's
  // start rightwards, so the window has to reach far enough past the last item
  // to keep that label inside the panel instead of clipped by its edge.
  const labelShare = Math.min(LABEL_BUDGET_PX / Math.max(viewportWidth, 1), 0.5);
  const span = Math.max(
    (lastStart - start) / (1 - labelShare),
    lastEnd - start + 30 * DAY_MS,
  );
  return { start: new Date(start), end: new Date(start + span) };
};

export const formatVisTimelineMinorLabel = (date: Date, scale: string): string => {
  if (scale === 'year') {
    return new Intl.DateTimeFormat('pl-PL', { year: 'numeric' }).format(date);
  }
  if (scale === 'month') {
    return new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date);
  }
  if (scale === 'week' || scale === 'weekday' || scale === 'day') {
    return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date);
};

export const formatVisTimelineMajorLabel = (date: Date, scale: string): string => {
  if (scale === 'year') return '';
  if (scale === 'month') {
    return new Intl.DateTimeFormat('pl-PL', { year: 'numeric' }).format(date);
  }
  if (scale === 'week' || scale === 'weekday' || scale === 'day') {
    return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
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
      rate_limited: 'Zbyt wiele prób. Spróbuj ponownie później.',
      internal: 'Nie udało się wgrać pliku. Spróbuj ponownie.',
    };
    return messages[error.appError.code];
  }
  return error instanceof Error ? error.message : 'Nie udało się wgrać pliku.';
};
