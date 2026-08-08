import { z } from 'zod';

export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  paginationQuerySchema,
  type PaginationQuery,
  type PaginationQueryInput,
} from '#core/domain/index.js';

export const paginatedOutputSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
