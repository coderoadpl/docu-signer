import type { ReactNode } from 'react';
import { Container } from '@mui/material';

interface PageContainerProps {
  children: ReactNode;
  wide?: boolean;
}

const READING_WIDTH = '76rem';
const WIDE_WIDTH = '96rem';

export const PageContainer = ({ children, wide = false }: PageContainerProps) => (
  <Container
    data-testid="page-container"
    sx={{ maxWidth: `${wide ? WIDE_WIDTH : READING_WIDTH} !important`, px: 2, py: 6 }}
  >
    {children}
  </Container>
);
