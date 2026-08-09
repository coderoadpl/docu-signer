import { z } from 'zod';

export {
  MAX_PAGE_LIMIT,
  decodeOpaqueCursor,
  encodeOpaqueCursor,
  paginationQuerySchema,
} from '#core/domain/index.js';

export const paginatedOutputSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
