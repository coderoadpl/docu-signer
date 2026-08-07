import { and, asc, eq, sql } from 'drizzle-orm';

import { staffRoleSchema, type Membership, type StaffRole } from '#core/domain/index.js';
import type {
  HealthPort,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
  TodoRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { members, tenantAdmins, tenantDomains, tenants, todos } from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const createTodoRepository = (db: Db): TodoRepository => ({
  listByTenant: async (tenantId) =>
    db.select().from(todos).where(eq(todos.tenantId, tenantId)).orderBy(asc(todos.createdAt)),
  create: async (todo) => {
    await db.insert(todos).values(todo);
  },
});

export const createTenantDomainRepository = (db: Db): TenantDomainRepository => ({
  findByDomain: async (domain) => {
    const rows = await db
      .select()
      .from(tenantDomains)
      .where(and(eq(tenantDomains.domain, domain), eq(tenantDomains.verified, true)))
      .limit(1);
    return rows[0] ?? null;
  },
  listVerifiedDomains: async () =>
    db.select().from(tenantDomains).where(eq(tenantDomains.verified, true)),
});

export const createTenantRepository = (db: Db): TenantRepository => ({
  findById: async (tenantId) => {
    const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return rows[0] ?? null;
  },
  findBySlug: async (slug) => {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    return rows[0] ?? null;
  },
  createTenant: async (input) => {
    await db.insert(tenants).values(input);
    return { id: input.id, slug: input.slug, name: input.name };
  },
  createOwnerGrant: async (input) => {
    await db.insert(tenantAdmins).values({
      id: input.id,
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.staffRole,
    });
  },
});

export const createTenantAccessReader = (db: Db): TenantAccessReader => {
  const baseQuery = () =>
    db
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        staffRole: tenantAdmins.role,
      })
      .from(tenantAdmins)
      .innerJoin(tenants, eq(tenantAdmins.tenantId, tenants.id));

  const toMembership = (row: {
    id: string;
    slug: string;
    name: string;
    staffRole: string;
  }): Membership | null => {
    const staffRole = parseStaffRole(row.staffRole);
    return staffRole ? { tenant: { id: row.id, slug: row.slug, name: row.name }, staffRole } : null;
  };

  return {
    listTenantsForStaff: async (userId) => {
      const rows = await baseQuery().where(eq(tenantAdmins.userId, userId));
      const memberships: Membership[] = [];
      for (const row of rows) {
        const membership = toMembership(row);
        if (membership) memberships.push(membership);
      }
      return memberships;
    },
    findStaffGrant: async (userId, lookup) => {
      const tenantCondition =
        'tenantId' in lookup ? eq(tenants.id, lookup.tenantId) : eq(tenants.slug, lookup.tenantSlug);
      const rows = await baseQuery()
        .where(and(eq(tenantAdmins.userId, userId), tenantCondition))
        .limit(1);
      const row = rows[0];
      return row ? toMembership(row) : null;
    },
    findMember: async (userId, tenantId) => {
      const rows = await db
        .select()
        .from(members)
        .where(and(eq(members.userId, userId), eq(members.tenantId, tenantId)))
        .limit(1);
      return rows[0] ?? null;
    },
  };
};

export const createHealthPort = (db: Db): HealthPort => ({
  pingDatabase: async () => {
    try {
      await db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  },
});
