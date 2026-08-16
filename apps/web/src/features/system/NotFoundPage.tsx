import { Button } from '@mui/material';
import { createLink } from '@tanstack/react-router';

import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';

const RouterButton = createLink(Button);

export const NotFoundPage = () => {
  return (
    <PageContainer>
      <StatusView
        state={{
          kind: 'empty',
          title: 'Nie znaleziono strony',
          action: (
            <RouterButton
              variant="contained"
              to="/app/documents"
            >
              Wróć do dokumentów
            </RouterButton>
          ),
        }}
      />
    </PageContainer>
  );
};
