import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MAX_PAGE_LIMIT,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  paginatedOutputSchema,
  paginationQuerySchema,
} from './pagination.js';

describe('cursor pagination contract', () => {
  it('round-trips an opaque keyed cursor', () => {
    const key = { createdAt: '2026-07-27T12:00:00.000Z', id: 'member-2' };
    const cursor = encodeOpaqueCursor(key);

    expect(cursor).not.toContain(key.createdAt);
    expect(decodeOpaqueCursor(cursor)).toEqual(key);
  });

  it('defaults and caps the page size at the server contract boundary', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ limit: '999' })).toEqual({ limit: MAX_PAGE_LIMIT });
    expect(paginationQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('shares the items plus nullable termination shape', () => {
    const schema = paginatedOutputSchema(z.string());
    expect(schema.parse({ items: ['a'], nextCursor: 'opaque' })).toEqual({
      items: ['a'],
      nextCursor: 'opaque',
    });
    expect(schema.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});
