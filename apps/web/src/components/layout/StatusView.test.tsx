import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StatusView } from './StatusView.js';

describe('StatusView', () => {
  it('renders the loading label', () => {
    render(<StatusView state={{ kind: 'loading', label: 'opening the app…' }} />);

    expect(screen.getByText('opening the app…')).toBeInTheDocument();
  });

  it('renders an error with a working retry action', async () => {
    const onRetry = vi.fn();
    render(
      <StatusView
        state={{
          kind: 'error',
          message: 'Something went wrong',
          retry: { label: 'try again', onRetry },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders an error without a retry action', () => {
    render(<StatusView state={{ kind: 'error', message: 'Something went wrong' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an empty state with body and action', () => {
    render(
      <StatusView
        state={{
          kind: 'empty',
          title: 'Nothing here yet',
          body: 'Create the first item.',
          action: <button type="button">create item</button>,
        }}
        data-testid="empty-state"
      />,
    );

    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('Create the first item.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'create item' })).toBeInTheDocument();
  });

  it('renders inside an existing surface', () => {
    render(
      <StatusView
        state={{ kind: 'empty', title: 'Nothing here yet' }}
        surface={false}
        data-testid="inline-empty"
      />,
    );

    expect(screen.getByTestId('inline-empty')).not.toHaveClass('MuiPaper-root');
  });
});
