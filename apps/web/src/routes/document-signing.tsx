import { useParams } from '@tanstack/react-router';

import { DocumentSigningPage } from '../features/documents/DocumentSigningPage.js';

export const DocumentSigningRoute = () => {
  const { id, fileId } = useParams({
    from: '/app/documents/$id/sign/$fileId',
  });
  return <DocumentSigningPage documentId={id} fileId={fileId} />;
};
