import { z } from 'zod';

export const __SINGULAR_CAMEL__Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(500),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});

export type __SINGULAR_PASCAL__ = z.infer<typeof __SINGULAR_CAMEL__Schema>;

export const new__SINGULAR_PASCAL__Schema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(500, 'Title too long'),
});

export type New__SINGULAR_PASCAL__ = z.infer<typeof new__SINGULAR_PASCAL__Schema>;
