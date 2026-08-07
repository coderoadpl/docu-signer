import { z } from 'zod';

import {
  membershipSchema,
  newTodoSchema,
  staffRoleSchema,
  tenantSchema,
  todoSchema,
} from '#core/domain/index.js';

/**
 * Single source of truth for the HTTP API shared by server and all clients.
 * Every route is described by its method, path and zod schemas; the server
 * implements them, `core/client` consumes them. Neither side hand-writes URLs
 * or response types anywhere else.
 */

export const healthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  database: z.enum(['up', 'down']),
});

export const meOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema.nullable(),
      memberId: z.string().nullable(),
    })
    .nullable(),
});

export const tenantListOutputSchema = z.object({
  tenants: z.array(membershipSchema),
});

export const todoListOutputSchema = z.object({
  todos: z.array(todoSchema),
});

export const tenantCreateInputSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export type TenantCreateInput = z.input<typeof tenantCreateInputSchema>;

export const tenantCreateOutputSchema = z.object({
  tenant: tenantSchema,
});

export const todoCreateInputSchema = newTodoSchema;

export const todoCreateOutputSchema = z.object({
  todo: todoSchema,
});

/**
 * Every route carries its HTTP method so clients can discriminate reads from
 * writes at the type level (CQRS partition). Safe GETs are queries; unsafe
 * verbs are commands. `core/client` brands its call surface from these methods.
 */
export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  me: { method: 'GET', path: '/api/me' },
  tenants: { method: 'GET', path: '/api/tenants' },
  tenantsCreate: { method: 'POST', path: '/api/tenants' },
  todos: { method: 'GET', path: '/api/todos' },
  todosCreate: { method: 'POST', path: '/api/todos' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  me: API_ROUTES.me.path,
  tenants: API_ROUTES.tenants.path,
  todos: API_ROUTES.todos.path,
} as const;

/** Header used by non-browser clients (CLI, tests) to select the tenant. */
export const TENANT_HEADER = 'x-tenant';
