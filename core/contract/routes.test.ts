import { describe, expect, it } from 'vitest';

import {
  API_PATHS,
  API_ROUTES,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  memberEnsureOutputSchema,
  memberListOutputSchema,
  memberRemoveOutputSchema,
  meOutputSchema,
  TENANT_HEADER,
  tenantCreateInputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  todoCreateInputSchema,
  todoCreateOutputSchema,
  todoListOutputSchema,
} from './routes.js';

const exampleMember = {
  id: 'm1',
  tenantId: 'acme',
  userId: null,
  email: 'a@b.com',
  displayName: 'Ada',
  tags: ['vip'],
  marketingConsents: [{ channel: 'email', granted: true, updatedAt: '2026-07-10T00:00:00.000Z' }],
  externalCustomerIds: [],
  createdAt: '2026-07-03T00:00:00.000Z',
  lastSeenAt: null,
};

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
    expect(API_ROUTES.members.method).toBe('GET');
    expect(API_ROUTES.membersEnsure.method).toBe('POST');
    expect(API_ROUTES.membersUpdate.method).toBe('POST');
    expect(API_ROUTES.membersRemove.method).toBe('POST');
    expect(API_ROUTES.membersExport.method).toBe('GET');
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
    const example = { status: 'ok', version: '0.1.0', sha: 'deadbeef', database: 'up' };
    expect(healthOutputSchema.parse(example)).toEqual(example);
    expect(healthOutputSchema.safeParse({ ...example, database: 'sideways' }).success).toBe(false);
    expect(healthOutputSchema.safeParse({ status: 'ok', version: '0.1.0', database: 'up' }).success).toBe(false);
  });

  it('healthLiveOutputSchema carries attestation without a database field', () => {
    const example = { status: 'ok', version: '0.1.0', sha: 'deadbeef' };
    expect(healthLiveOutputSchema.parse(example)).toEqual(example);
    expect(healthLiveOutputSchema.safeParse({ ...example, sha: undefined }).success).toBe(false);
  });

  it('healthReadyOutputSchema only accepts database up', () => {
    const example = { status: 'ok', version: '0.1.0', sha: 'deadbeef', database: 'up' };
    expect(healthReadyOutputSchema.parse(example)).toEqual(example);
    expect(healthReadyOutputSchema.safeParse({ ...example, database: 'down' }).success).toBe(false);
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

  it('memberListOutputSchema', () => {
    const example = { members: [exampleMember] };
    expect(memberListOutputSchema.parse(example)).toEqual(example);
  });

  it('memberEnsureOutputSchema carries the created flag', () => {
    const example = { member: exampleMember, created: true };
    expect(memberEnsureOutputSchema.parse(example)).toEqual(example);
    expect(memberEnsureOutputSchema.safeParse({ member: exampleMember }).success).toBe(false);
  });

  it('memberRemoveOutputSchema reports the cascade counts', () => {
    const example = { memberId: 'm1', deleted: { members: 1 } };
    expect(memberRemoveOutputSchema.parse(example)).toEqual(example);
  });
});
