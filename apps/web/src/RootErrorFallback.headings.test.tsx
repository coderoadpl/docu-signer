import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { appError, forbidden, internal, notFound, tenantNotFound, validation } from '#core/domain/index.js';

import { renderRootErrorFallback } from './RootErrorFallback.js';

const cases = [
  [forbidden('x'), 'You do not have access'],
  [notFound('x'), 'Nothing here'],
  [tenantNotFound('x'), 'Unknown tenant'],
  [validation('x'), 'That request was invalid'],
  [appError('conflict', 'x'), 'A conflicting change happened'],
  [internal('x'), 'Something went wrong'],
] as const;

describe('renderRootErrorFallback headings', () => {
  it.each(cases)('maps the %# taxonomy code to its heading', (error, heading) => {
    render(renderRootErrorFallback(new ApiError(error)));

    expect(screen.getByRole('alert')).toHaveTextContent(heading);
  });
});
