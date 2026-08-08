import {
  err,
  newTodoSchema,
  ok,
  validation,
  type AppError,
  type NewTodo,
  type Result,
  type Todo,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, TodoRepository } from '../ports.js';

export interface TodoDeps {
  todos: TodoRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const listTodos = async (ctx: Ctx, deps: TodoDeps): Promise<Result<Todo[], AppError>> => {
  const scope = authorizeTenant(ctx, 'todo:read');
  if (!scope.ok) return scope;
  return ok(await deps.todos.listByTenant(scope.value));
};

export const addTodo = async (
  ctx: Ctx,
  input: NewTodo,
  deps: TodoDeps,
): Promise<Result<Todo, AppError>> => {
  const scope = authorizeTenant(ctx, 'todo:write');
  if (!scope.ok) return scope;

  const parsed = newTodoSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid todo', parsed.error.flatten()));

  const todo: Todo = {
    id: deps.ids.nextId(),
    tenantId: scope.value,
    title: parsed.data.title,
    createdBy: ctx.identity.userId,
    createdAt: deps.clock.nowIso(),
  };
  await deps.todos.create(todo);
  return ok(todo);
};
