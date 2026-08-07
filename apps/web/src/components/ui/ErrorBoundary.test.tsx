import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.js';

const Boom = () => {
  throw new Error('render exploded');
};

describe('ErrorBoundary', () => {
  it('renders the fallback when a child throws during render', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary fallback={() => <div role="alert">boundary fallback</div>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('boundary fallback');
    errorSpy.mockRestore();
  });
});
