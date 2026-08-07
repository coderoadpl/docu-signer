import {
  err,
  newTodoSchema,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type NewTodo,
  type Result,
  type Todo,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, TodoRepository } from '../ports.js';

export interface TodoDeps {
  todos: TodoRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const listTodos = async (ctx: Ctx, deps: TodoDeps): Promise<Result<Todo[], AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to list todos'));
  return ok(await deps.todos.listByTenant(ctx.identity.tenantId));
};

export const addTodo = async (
  ctx: Ctx,
  input: NewTodo,
  deps: TodoDeps,
): Promise<Result<Todo, AppError>> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to add todos'));

  const parsed = newTodoSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid todo', parsed.error.flatten()));

  const todo: Todo = {
    id: deps.ids.nextId(),
    tenantId: ctx.identity.tenantId,
    title: parsed.data.title,
    createdBy: ctx.identity.userId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.todos.create(todo);
  return ok(todo);
};
