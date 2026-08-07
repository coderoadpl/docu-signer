import { describe, expect, it } from 'vitest';

import {
  API_PATHS,
  API_ROUTES,
  healthOutputSchema,
  meOutputSchema,
  TENANT_HEADER,
  tenantCreateInputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  todoCreateInputSchema,
  todoCreateOutputSchema,
  todoListOutputSchema,
} from './routes.js';

describe('API_ROUTES', () => {
  it('gives every route an HTTP method and an /api path', () => {
    for (const route of Object.values(API_ROUTES)) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(route.method);
      expect(route.path.startsWith('/api/')).toBe(true);
    }
  });

  it('uses safe verbs for reads and unsafe verbs for writes', () => {
    expect(API_ROUTES.health.method).toBe('GET');
    expect(API_ROUTES.me.method).toBe('GET');
    expect(API_ROUTES.tenants.method).toBe('GET');
    expect(API_ROUTES.tenantsCreate.method).toBe('POST');
    expect(API_ROUTES.todos.method).toBe('GET');
    expect(API_ROUTES.todosCreate.method).toBe('POST');
  });
});

describe('API_PATHS', () => {
  it('mirrors the GET route paths', () => {
    expect(API_PATHS.health).toBe(API_ROUTES.health.path);
    expect(API_PATHS.me).toBe(API_ROUTES.me.path);
    expect(API_PATHS.tenants).toBe(API_ROUTES.tenants.path);
    expect(API_PATHS.todos).toBe(API_ROUTES.todos.path);
  });
});

describe('TENANT_HEADER', () => {
  it('is the lowercase tenant selector header', () => {
    expect(TENANT_HEADER).toBe('x-tenant');
  });
});

describe('route schemas parse their example payloads', () => {
  it('healthOutputSchema', () => {
    const example = { status: 'ok', version: '0.1.0', database: 'up' };
    expect(healthOutputSchema.parse(example)).toEqual(example);
    expect(healthOutputSchema.safeParse({ ...example, database: 'sideways' }).success).toBe(false);
  });

  it('meOutputSchema with a tenant', () => {
    const example = {
      userId: 'u1',
      email: 'a@b.com',
      name: 'Ada',
      tenant: { id: 't1', slug: 'acme', name: 'Acme', staffRole: 'owner', memberId: 'm1' },
    };
    expect(meOutputSchema.parse(example)).toEqual(example);
  });

  it('meOutputSchema with a null tenant', () => {
    const example = { userId: 'u1', email: 'a@b.com', name: 'Ada', tenant: null };
    expect(meOutputSchema.parse(example).tenant).toBeNull();
  });

  it('tenantListOutputSchema', () => {
    const example = {
      tenants: [{ tenant: { id: 't1', slug: 'acme', name: 'Acme' }, staffRole: 'admin' }],
    };
    expect(tenantListOutputSchema.parse(example)).toEqual(example);
  });

  it('todoListOutputSchema', () => {
    const example = {
      todos: [
        {
          id: 't1',
          tenantId: 'acme',
          title: 'Buy milk',
          createdBy: 'u1',
          createdAt: '2026-07-03T00:00:00.000Z',
        },
      ],
    };
    expect(todoListOutputSchema.parse(example)).toEqual(example);
  });

  it('tenantCreateInputSchema', () => {
    const example = { slug: 'acme', name: 'Acme' };
    expect(tenantCreateInputSchema.parse(example)).toEqual(example);
    expect(tenantCreateInputSchema.safeParse({ slug: 'acme' }).success).toBe(false);
  });

  it('tenantCreateOutputSchema', () => {
    const example = { tenant: { id: 't1', slug: 'acme', name: 'Acme' } };
    expect(tenantCreateOutputSchema.parse(example)).toEqual(example);
  });

  it('todoCreateInputSchema trims the title', () => {
    expect(todoCreateInputSchema.parse({ title: '  hi  ' })).toEqual({ title: 'hi' });
    expect(todoCreateInputSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('todoCreateOutputSchema', () => {
    const example = {
      todo: {
        id: 't1',
        tenantId: 'acme',
        title: 'Buy milk',
        createdBy: 'u1',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
    };
    expect(todoCreateOutputSchema.parse(example)).toEqual(example);
  });
});
