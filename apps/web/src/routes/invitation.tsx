import { useParams } from '@tanstack/react-router';

import { InvitationAcceptPage } from '../features/auth/InvitationAcceptPage.js';

export const InvitationRoute = () => {
  const { token } = useParams({ strict: false });
  return <InvitationAcceptPage token={typeof token === 'string' ? token : ''} />;
};
