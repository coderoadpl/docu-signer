import { describe, expect, it } from 'vitest';

import {
  appError,
  ERROR_CODES,
  forbidden,
  internal,
  notFound,
  tenantNotFound,
  unauthorized,
  validation,
} from './errors.js';

describe('appError', () => {
  it('omits details when undefined', () => {
    expect(appError('internal', 'boom')).toEqual({ code: 'internal', message: 'boom' });
  });

  it('includes details when provided', () => {
    expect(appError('validation', 'bad', { field: 'title' })).toEqual({
      code: 'validation',
      message: 'bad',
      details: { field: 'title' },
    });
  });

  it('keeps details even when falsy but defined', () => {
    expect(appError('validation', 'bad', null)).toEqual({
      code: 'validation',
      message: 'bad',
      details: null,
    });
  });
});

describe('error constructors', () => {
  it('unauthorized uses default and custom messages', () => {
    expect(unauthorized()).toEqual({ code: 'unauthorized', message: 'Authentication required' });
    expect(unauthorized('nope')).toEqual({ code: 'unauthorized', message: 'nope' });
  });

  it('forbidden uses default and custom messages', () => {
    expect(forbidden()).toEqual({ code: 'forbidden', message: 'Not allowed' });
    expect(forbidden('denied')).toEqual({ code: 'forbidden', message: 'denied' });
  });

  it('notFound uses default and custom messages', () => {
    expect(notFound()).toEqual({ code: 'not_found', message: 'Not found' });
    expect(notFound('missing')).toEqual({ code: 'not_found', message: 'missing' });
  });

  it('validation carries a message and optional details', () => {
    expect(validation('bad input')).toEqual({ code: 'validation', message: 'bad input' });
    expect(validation('bad input', ['title'])).toEqual({
      code: 'validation',
      message: 'bad input',
      details: ['title'],
    });
  });

  it('tenantNotFound uses default and custom messages', () => {
    expect(tenantNotFound()).toEqual({ code: 'tenant_not_found', message: 'Unknown tenant' });
    expect(tenantNotFound('gone')).toEqual({ code: 'tenant_not_found', message: 'gone' });
  });

  it('internal uses default and custom messages', () => {
    expect(internal()).toEqual({ code: 'internal', message: 'Internal error' });
    expect(internal('kaboom')).toEqual({ code: 'internal', message: 'kaboom' });
  });
});

describe('ERROR_CODES taxonomy', () => {
  const constructorByCode: Record<(typeof ERROR_CODES)[number], () => { code: string }> = {
    unauthorized,
    forbidden,
    not_found: notFound,
    validation: () => validation('x'),
    conflict: () => appError('conflict', 'x'),
    tenant_not_found: tenantNotFound,
    internal,
  };

  it('has every code covered by a constructor that produces the matching code', () => {
    for (const code of ERROR_CODES) {
      expect(constructorByCode[code]().code).toBe(code);
    }
  });

  it('contains no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
