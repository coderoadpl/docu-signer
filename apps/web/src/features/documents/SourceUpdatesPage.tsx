import { Button, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { PageContainer } from '../../components/layout/PageContainer.js';
import { StatusView } from '../../components/layout/StatusView.js';

export const SourceUpdatesPage = () => {
  const navigate = useNavigate();
  const requests = useQuery(actions.pendingSourceUpdateRequests);
  const documents = useQuery(actions.documents({ draft: 'all' }));
  if (requests.isPending || documents.isPending) {
    return (
      <PageContainer>
        <StatusView state={{ kind: 'loading', label: 'Ładowanie aktualizacji…' }} />
      </PageContainer>
    );
  }
  if (requests.isError || documents.isError) {
    return (
      <PageContainer>
        <StatusView
          state={{
            kind: 'error',
            message:
              requests.error?.message ??
              documents.error?.message ??
              'Nie udało się pobrać aktualizacji.',
          }}
        />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <Typography variant="h1">Aktualizacje źródeł</Typography>
      {requests.data.requests.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          Brak wniosków oczekujących na Twoją decyzję.
        </Typography>
      ) : (
        <Stack sx={{ mt: 3, gap: 2 }}>
          {requests.data.requests.map((request) => {
            const document = documents.data.documents.find(
              (candidate) => candidate.id === request.documentId,
            );
            return (
              <Paper key={request.id} variant="outlined" sx={{ p: 2.5 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ gap: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                >
                  <Stack>
                    <Typography variant="h3">
                      {document?.title ?? 'Dokument'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Nowe źródło czeka na Twoją akceptację.
                    </Typography>
                  </Stack>
                  <Button
                    variant="contained"
                    onClick={() =>
                      void navigate({
                        to: '/app/documents/$id',
                        params: { id: request.documentId },
                      })
                    }
                  >
                    Otwórz dokument
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </PageContainer>
  );
};
