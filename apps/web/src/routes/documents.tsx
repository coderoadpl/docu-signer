import { DocumentsPage } from '../features/documents/DocumentsPage.js';
import {
  documentsSearchSchema,
  type DocumentsSearchParams,
} from '../features/documents/documents.logic.js';

export { documentsSearchSchema };

type LegacyDocumentsRedirect =
  | { to: '/app/kosz' }
  | { to: '/app/documents'; search: DocumentsSearchParams };

export const legacyDocumentsRedirect = (
  searchString: string,
): LegacyDocumentsRedirect | null => {
  const params = new URLSearchParams(searchString);
  const tab = params.get('tab');
  if (tab === 'kosz') return { to: '/app/kosz' };
  if (tab !== 'teczki') return null;
  params.delete('tab');
  return {
    to: '/app/documents',
    search: documentsSearchSchema.parse(Object.fromEntries(params)),
  };
};

export const DocumentsRoute = () => <DocumentsPage />;
