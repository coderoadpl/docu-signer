import { z } from 'zod';

export const todoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  title: z.string().min(1).max(500),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
});

export type Todo = z.infer<typeof todoSchema>;

export const newTodoSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(500, 'Title too long'),
});

export type NewTodo = z.infer<typeof newTodoSchema>;
