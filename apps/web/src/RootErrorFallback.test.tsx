import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { unauthorized } from '#core/domain/index.js';

import { RootErrorFallback, renderRootErrorFallback } from './RootErrorFallback.js';

describe('renderRootErrorFallback', () => {
  it('maps an ApiError to its taxonomy heading and message', () => {
    render(renderRootErrorFallback(new ApiError(unauthorized('Your session expired'))));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your session has ended');
    expect(alert).toHaveTextContent('Your session expired');
  });

  it('falls back to a generic heading for a non-ApiError throw', () => {
    render(renderRootErrorFallback(new Error('boom')));

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('RootErrorFallback', () => {
  it('renders the active trace id when one is present', () => {
    render(<RootErrorFallback error={new Error('boom')} traceId="0af7651916cd43dd8448eb211c80319c" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Trace ID: 0af7651916cd43dd8448eb211c80319c');
  });

  it('omits the trace id line when tracing is inactive', () => {
    render(<RootErrorFallback error={new Error('boom')} traceId={undefined} />);

    expect(screen.getByRole('alert')).not.toHaveTextContent('Trace ID');
  });
});
