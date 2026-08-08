import { useParams } from '@tanstack/react-router';

import { DocumentDetailPage } from '../features/documents/DocumentDetailPage.js';

export const DocumentDetailRoute = () => {
  const { id } = useParams({ from: '/documents/$id' });
  return <DocumentDetailPage documentId={id} />;
};
