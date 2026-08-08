import type { ReactNode } from 'react';
import { Container } from '@mui/material';

interface PageContainerProps {
  children: ReactNode;
}

export const PageContainer = ({ children }: PageContainerProps) => (
  <Container
    data-testid="page-container"
    sx={{ maxWidth: '76rem !important', px: 2, py: 6 }}
  >
    {children}
  </Container>
);
