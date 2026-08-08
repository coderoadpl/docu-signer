import { Button } from '@mui/material';
import { useNavigate } from '@tanstack/react-router';

import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';

export const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <StatusView
        state={{
          kind: 'empty',
          title: 'Nie znaleziono strony',
          action: (
            <Button
              variant="contained"
              onClick={() => void navigate({ to: '/app/documents' })}
            >
              Wróć do dokumentów
            </Button>
          ),
        }}
      />
    </PageContainer>
  );
};
