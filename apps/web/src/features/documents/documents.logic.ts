import { ApiError } from '#core/client/index.js';
import {
  type CreateDocument,
  type DocumentFile,
  type DocumentFileRole,
  type DocumentListFilter,
  type SavedSearchFilter,
  type DocumentType,
  type DocumentWithFiles,
  type UpdateDocument,
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

export const FILE_ROLE_SYMBOLS: Record<DocumentFileRole, string> = {
  source: '◻',
  'signed-scan': '▧',
  'signed-digital': '✦',
  other: '•',
};

export interface DocumentFormValues {
  title: string;
  docType: DocumentType;
  documentDate: string;
  periodStart: string;
  periodEnd: string;
  person: string;
  tags: string;
}

export interface DocumentFilterValues {
  text: string;
  docType: DocumentType | '';
  person: string;
  tag: string;
  dateFrom: string;
  dateTo: string;
}

export const emptyDocumentFilters = (): DocumentFilterValues => ({
  text: '',
  docType: '',
  person: '',
  tag: '',
  dateFrom: '',
  dateTo: '',
});

export const emptyDocumentForm = (): DocumentFormValues => ({
  title: '',
  docType: 'umowa-uod',
  documentDate: '',
  periodStart: '',
  periodEnd: '',
  person: '',
  tags: '',
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
  tags: values.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),
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
}): DocumentListFilter => ({
  ...(values.text.trim() ? { text: values.text.trim() } : {}),
  ...(values.docType ? { docType: values.docType } : {}),
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  ...(values.tag.trim() ? { tag: values.tag.trim() } : {}),
  ...(values.dateFrom ? { dateFrom: values.dateFrom } : {}),
  ...(values.dateTo ? { dateTo: values.dateTo } : {}),
});

export const toDocumentFilterValues = (filter: SavedSearchFilter): DocumentFilterValues => ({
  text: filter.text ?? '',
  docType: filter.docType ?? '',
  person: filter.person ?? '',
  tag: filter.tag ?? '',
  dateFrom: filter.dateFrom ?? '',
  dateTo: filter.dateTo ?? '',
});

export const hasDocumentFilter = (filter: DocumentListFilter): boolean =>
  Object.values(filter).some((value) => value !== undefined && value.length > 0);

export const documentFilterSummary = (filter: SavedSearchFilter): string => {
  const parts = [
    filter.text ? `Tytuł: ${filter.text}` : '',
    filter.docType ? `Typ: ${DOCUMENT_TYPE_LABELS[filter.docType]}` : '',
    filter.person ? `Osoba: ${filter.person}` : '',
    filter.tag ? `Tag: ${filter.tag}` : '',
    filter.dateFrom ? `Od: ${formatPolishDate(filter.dateFrom)}` : '',
    filter.dateTo ? `Do: ${formatPolishDate(filter.dateTo)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Wszystkie dokumenty';
};

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

export const relatedDocuments = (
  current: Pick<DocumentWithFiles, 'id' | 'tags'>,
  documents: Array<Pick<DocumentWithFiles, 'id' | 'title' | 'docType' | 'tags'>>,
): Array<Pick<DocumentWithFiles, 'id' | 'title' | 'docType' | 'tags'>> => {
  if (current.tags.length === 0) return [];
  return documents
    .filter(
      (document) =>
        document.id !== current.id &&
        current.tags.some((tag) => document.tags.includes(tag)),
    )
    .slice(0, 10);
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
