import { and, eq, sql } from 'drizzle-orm';

import { staffRoleSchema, type StaffRole } from '#core/domain/index.js';
import type {
  HealthPort,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { tenantAdmins, tenantDomains, tenants } from './schema.js';

const parseStaffRole = (raw: string): StaffRole | null => {
  const parsed = staffRoleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

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
});

export const createTenantAccessReader = (db: Db): TenantAccessReader => ({
  findStaffGrant: async (userId, tenantId) => {
    const rows = await db
      .select({ staffRole: tenantAdmins.role })
      .from(tenantAdmins)
      .where(and(eq(tenantAdmins.userId, userId), eq(tenantAdmins.tenantId, tenantId)))
      .limit(1);
    const raw = rows[0]?.staffRole;
    if (!raw) return null;
    const staffRole = parseStaffRole(raw);
    return staffRole ? { staffRole } : null;
  },
});

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
