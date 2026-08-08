import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FocusCard } from './FocusCard.js';

describe('FocusCard', () => {
  it('renders header, action and content in the focused surface', () => {
    render(
      <FocusCard header={<h1>agentproofarch</h1>} action={<button type="button">sign out</button>}>
        <p>create a tenant</p>
      </FocusCard>,
    );

    expect(screen.getByRole('heading', { name: 'agentproofarch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'sign out' })).toBeInTheDocument();
    expect(screen.getByText('create a tenant')).toBeInTheDocument();
  });
});
