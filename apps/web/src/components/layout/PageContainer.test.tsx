import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageContainer } from './PageContainer.js';

describe('PageContainer', () => {
  it('renders page content inside the shared document width and spacing', () => {
    render(
      <PageContainer>
        <p>page content</p>
      </PageContainer>,
    );

    expect(screen.getByTestId('page-container')).toHaveStyle({
      maxWidth: '76rem !important',
      paddingLeft: '16px',
      paddingRight: '16px',
      paddingTop: '48px',
      paddingBottom: '48px',
    });
    expect(screen.getByText('page content')).toBeInTheDocument();
  });
});
