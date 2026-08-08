import { describe, expect, it } from 'vitest';

import type { Member, Membership, Tenant, TenantDomain } from '#core/domain/index.js';

import type { MemberRepository, TenantAccessReader, TenantDomainRepository, TenantRepository } from '../ports.js';
import { resolveIdentity } from './resolve-identity.js';

const user = { userId: 'u1', email: 'demo@example.com', name: 'Demo' };

const acme: Membership = {
  tenant: { id: 't-acme', slug: 'acme', name: 'Acme Inc' },
  staffRole: 'owner',
};

const member: Member = {
  id: 'member-acme',
  tenantId: 't-acme',
  userId: 'u1',
  email: 'demo@example.com',
  displayName: 'Demo',
  tags: [],
  marketingConsents: [],
  externalCustomerIds: [],
  createdAt: '2026-07-11T00:00:00.000Z',
  lastSeenAt: null,
};

const fakeTenantAccess = (memberships: Membership[], members: Member[] = []): TenantAccessReader => ({
  listTenantsForStaff: async () => memberships,
  findStaffGrant: async (_userId, lookup) =>
    memberships.find((m) =>
      'tenantId' in lookup ? m.tenant.id === lookup.tenantId : m.tenant.slug === lookup.tenantSlug,
    ) ?? null,
  findMember: async (userId, tenantId) =>
    members.find((candidate) => candidate.tenantId === tenantId && candidate.userId === userId) ?? null,
});

const fakeDomains = (domains: TenantDomain[]): TenantDomainRepository => ({
  findByDomain: async (domain) => domains.find((d) => d.domain === domain) ?? null,
  listVerifiedDomains: async () => domains,
  listByTenant: async (tenantId) => domains.filter((d) => d.tenantId === tenantId),
  findAnyByDomain: async (domain) => domains.find((d) => d.domain === domain) ?? null,
  findByTenantAndDomain: async (tenantId, domain) =>
    domains.find((d) => d.tenantId === tenantId && d.domain === domain) ?? null,
  add: async (input) => input,
  setVerified: async () => null,
  removeByTenantAndDomain: async () => 0,
});

const fakeMembers = (rows: Member[]): MemberRepository => ({
  listByTenant: async (tenantId) => rows.filter((r) => r.tenantId === tenantId),
  findByEmail: async (tenantId, email) =>
    rows.find((r) => r.tenantId === tenantId && r.email === email) ?? null,
  findByTenantAndId: async (tenantId, id) =>
    rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null,
  create: async (member) => {
    rows.push(member);
  },
  update: async (member) => {
    const index = rows.findIndex((r) => r.id === member.id);
    if (index >= 0) rows[index] = member;
  },
  deleteByTenantAndId: async () => 0,
});

const fakeTenants = (tenantList: Tenant[]): TenantRepository => ({
  findById: async (tenantId) => tenantList.find((tenant) => tenant.id === tenantId) ?? null,
  findBySlug: async (slug) => tenantList.find((tenant) => tenant.slug === slug) ?? null,
  createTenantWithOwner: async (input) => ({
    id: input.tenant.id,
    slug: input.tenant.slug,
    name: input.tenant.name,
  }),
  deleteTenant: async () => undefined,
});

const deps = (
  memberships: Membership[],
  domains: TenantDomain[] = [],
  memberRows: Member[] = [],
  tenantRows: Tenant[] = [acme.tenant],
) => ({
  tenantAccess: fakeTenantAccess(memberships, memberRows),
  tenants: fakeTenants(tenantRows),
  tenantDomains: fakeDomains(domains),
  members: fakeMembers(memberRows),
  clock: { nowIso: () => '2026-07-11T00:00:00.000Z' },
  baseDomain: 'localhost',
});

describe('resolveIdentity', () => {
  it('rejects anonymous requests', async () => {
    const result = await resolveIdentity(null, { host: 'localhost', tenantHeader: null }, deps([]));
    expect(result).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('resolves tenant from subdomain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantSlug: 'acme', staffRole: 'owner' } });
  });

  it('resolves tenant from X-Tenant header on the base domain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:4711', tenantHeader: 'acme' },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantId: 't-acme' } });
  });

  it('resolves tenant from a custom domain and requires membership', async () => {
    const domain: TenantDomain = {
      id: 'd1',
      tenantId: 't-acme',
      domain: 'todo.example.com',
      kind: 'custom',
      verified: true,
    };
    const okResult = await resolveIdentity(
      user,
      { host: 'todo.example.com', tenantHeader: null },
      deps([acme], [domain]),
    );
    expect(okResult).toMatchObject({ ok: true, value: { tenantId: 't-acme' } });

    const denied = await resolveIdentity(
      user,
      { host: 'todo.example.com', tenantHeader: null },
      deps([], [domain]),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('resolves member-only identity without staff enumeration rights', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([], [], [member]),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', staffRole: null, memberId: 'member-acme' },
    });
  });

  it('binds a provisioned (null userId) member on first sign-in and surfaces its memberId (US-026)', async () => {
    const provisioned: Member = {
      ...member,
      id: 'member-provisioned',
      userId: null,
      email: 'demo@example.com',
    };
    // findMember (by userId) returns null for the unbound row; the members repo
    // still holds it by email, so resolveIdentity binds it and grants access.
    const result = await resolveIdentity(
      user,
      { host: 'acme.localhost:4711', tenantHeader: null },
      deps([], [], [provisioned]),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { tenantId: 't-acme', staffRole: null, memberId: 'member-provisioned' },
    });
  });

  it('returns tenant-less identity on the bare base domain', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'localhost:4711', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantId: null } });
  });

  it('rejects unknown tenants', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'globex.localhost', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'tenant_not_found',
        message: 'No tenant "globex" or you do not have access to it',
      },
    });
  });

  it('rejects a custom domain whose tenant row is missing', async () => {
    const domain: TenantDomain = {
      id: 'd1',
      tenantId: 't-ghost',
      domain: 'todo.example.com',
      kind: 'custom',
      verified: true,
    };
    const result = await resolveIdentity(
      user,
      { host: 'todo.example.com', tenantHeader: null },
      deps([acme], [domain], [], []),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found', message: 'Tenant domain is not attached' },
    });
  });

  it('ignores nested subdomains and treats the bare base domain as tenant-less', async () => {
    const result = await resolveIdentity(
      user,
      { host: 'a.b.localhost:4711', tenantHeader: null },
      deps([acme]),
    );
    expect(result).toMatchObject({ ok: true, value: { tenantId: null } });
  });

  it('uses the same tenant_not_found message for unknown and inaccessible slug tenants', async () => {
    const absent = await resolveIdentity(
      user,
      { host: 'acme.localhost', tenantHeader: null },
      deps([], [], [], []),
    );
    const inaccessible = await resolveIdentity(
      user,
      { host: 'acme.localhost', tenantHeader: null },
      deps([]),
    );

    expect(absent).toMatchObject({
      ok: false,
      error: {
        code: 'tenant_not_found',
        message: 'No tenant "acme" or you do not have access to it',
      },
    });
    expect(inaccessible).toEqual(absent);
  });
});
