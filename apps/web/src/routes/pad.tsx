import { useParams } from '@tanstack/react-router';

import { PadPage } from '../features/documents/PadPage.js';

export const PadRoute = () => {
  const { sessionId } = useParams({ from: '/pad/$sessionId' });
  return <PadPage sessionId={sessionId} />;
};
