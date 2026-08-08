import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .transform((limit) => Math.min(limit, MAX_PAGE_LIMIT))
    .default(DEFAULT_PAGE_LIMIT),
});

export type PaginationQuery = z.output<typeof paginationQuerySchema>;
export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;

export const encodeOpaqueCursor = (value: unknown): string =>
  btoa(encodeURIComponent(JSON.stringify(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

export const decodeOpaqueCursor = (cursor: string): unknown => {
  try {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent(atob(padded)));
  } catch {
    return undefined;
  }
};
