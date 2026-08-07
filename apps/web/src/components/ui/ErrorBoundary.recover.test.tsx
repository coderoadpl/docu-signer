import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.js';

const Boom = () => {
  throw new Error('render exploded');
};

describe('ErrorBoundary recovery', () => {
  it('reports the throw through onError and re-runs render on reset', async () => {
    const onError = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary
        onError={onError}
        fallback={(_error, reset) => (
          <button type="button" onClick={reset}>
            retry
          </button>
        )}
      >
        <Boom />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));

    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    errorSpy.mockRestore();
  });
});
