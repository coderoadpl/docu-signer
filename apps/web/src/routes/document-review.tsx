import { useParams } from '@tanstack/react-router';

import { DocumentReviewPage } from '../features/documents/DocumentReviewPage.js';

export const DocumentReviewRoute = () => {
  const { id } = useParams({ from: '/app/documents/$id/review' });
  return <DocumentReviewPage documentId={id} />;
};
