import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApiError } from '#core/client/index.js';
import { appError, forbidden, internal, notFound, tenantNotFound, validation } from '#core/domain/index.js';

import { renderRootErrorFallback } from './RootErrorFallback.js';

const cases = [
  [forbidden('x'), 'Nie masz dostępu'],
  [notFound('x'), 'Nie znaleziono zasobu'],
  [tenantNotFound('x'), 'Nieznana firma'],
  [validation('x'), 'Żądanie jest nieprawidłowe'],
  [appError('conflict', 'x'), 'Wystąpił konflikt zmian'],
  [internal('x'), 'Wystąpił błąd'],
] as const;

describe('renderRootErrorFallback headings', () => {
  it.each(cases)('maps the %# taxonomy code to its heading', (error, heading) => {
    render(renderRootErrorFallback(new ApiError(error)));

    expect(screen.getByRole('alert')).toHaveTextContent(heading);
  });
});
