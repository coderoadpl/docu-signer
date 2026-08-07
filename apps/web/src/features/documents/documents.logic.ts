import type {
  CreateDocument,
  DocumentFile,
  DocumentFileRole,
  DocumentListFilter,
  DocumentType,
  UpdateDocument,
} from '#core/domain/index.js';
import { ApiError } from '#core/client/index.js';

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
  person: string;
  tags: string;
}

export const emptyDocumentForm = (): DocumentFormValues => ({
  title: '',
  docType: 'umowa-uod',
  documentDate: new Date().toISOString().slice(0, 10),
  person: '',
  tags: '',
});

export const toDocumentInput = (values: DocumentFormValues): CreateDocument | UpdateDocument => ({
  title: values.title.trim(),
  docType: values.docType,
  documentDate: values.documentDate,
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  tags: values.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),
});

export const toDocumentFilter = (values: {
  text: string;
  docType: DocumentType | '';
  person: string;
  dateFrom: string;
  dateTo: string;
}): DocumentListFilter => ({
  ...(values.text.trim() ? { text: values.text.trim() } : {}),
  ...(values.docType ? { docType: values.docType } : {}),
  ...(values.person.trim() ? { person: values.person.trim() } : {}),
  ...(values.dateFrom ? { dateFrom: values.dateFrom } : {}),
  ...(values.dateTo ? { dateTo: values.dateTo } : {}),
});

export const filesByRole = (files: DocumentFile[]): Record<DocumentFileRole, DocumentFile[]> => ({
  source: files.filter((file) => file.role === 'source'),
  'signed-scan': files.filter((file) => file.role === 'signed-scan'),
  'signed-digital': files.filter((file) => file.role === 'signed-digital'),
  other: files.filter((file) => file.role === 'other'),
});

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
      tenant_not_found: 'Nie wybrano organizacji.',
      internal: 'Nie udało się wgrać pliku. Spróbuj ponownie.',
    };
    return messages[error.appError.code];
  }
  return error instanceof Error ? error.message : 'Nie udało się wgrać pliku.';
};
