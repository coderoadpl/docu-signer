import { and, eq, sql } from 'drizzle-orm';

import { staffMemberSchema } from '#core/domain/index.js';
import type { StaffGrant, StaffRepository, UserDirectory } from '#core/server/index.js';

import type { Db } from './client.js';
import { tenantAdmins, user } from './schema.js';

export const createStaffRepository = (db: Db): StaffRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select({
        id: tenantAdmins.id,
        userId: tenantAdmins.userId,
        email: user.email,
        name: user.name,
        role: tenantAdmins.role,
      })
      .from(tenantAdmins)
      .innerJoin(user, eq(tenantAdmins.userId, user.id))
      .where(eq(tenantAdmins.tenantId, tenantId))
      .orderBy(tenantAdmins.role, user.email);
    // Parse at the boundary: the `role` column stores a plain string the domain
    // schema narrows back to the `owner|admin` union.
    return rows.map((row) => staffMemberSchema.parse(row));
  },
  findGrant: async (tenantId, userId) => {
    const rows = await db
      .select({ id: tenantAdmins.id, userId: tenantAdmins.userId, role: tenantAdmins.role })
      .from(tenantAdmins)
      .where(and(eq(tenantAdmins.tenantId, tenantId), eq(tenantAdmins.userId, userId)))
      .limit(1);
    const row = rows[0];
    // The row's `role` is a stored string; narrow it through the grant shape.
    return row ? (staffGrantSchema.parse(row) satisfies StaffGrant) : null;
  },
  grant: async (input) => {
    await db.insert(tenantAdmins).values(input);
  },
  // MUST-ATOMIC (§Transactions): one conditional DELETE closes the last-owner
  // race mechanically. The `locked_owners` CTE selects the tenant's owner grants
  // FOR UPDATE, so two concurrent revokes of different owners serialize on those
  // row locks: the second waits, then re-reads the now-smaller owner set and
  // refuses to drop the final owner. The grant is deleted unless it is an owner
  // AND it is the only owner left. One statement → one round-trip on both drivers.
  revokeLastOwnerSafe: async (tenantId, userId) => {
    const result = await db.execute(sql`
      WITH locked_owners AS (
        SELECT id FROM tenant_admins
        WHERE tenant_id = ${tenantId} AND role = 'owner'
        FOR UPDATE
      )
      DELETE FROM tenant_admins
      WHERE tenant_id = ${tenantId} AND user_id = ${userId}
        AND (role <> 'owner' OR (SELECT count(*) FROM locked_owners) > 1)
      RETURNING id
    `);
    return rowCountOf(result);
  },
});

/**
 * `db.execute` returns the driver's native result: node-postgres yields
 * `{ rowCount, rows }`, neon-http yields the rows array directly. Normalise both
 * to the number of affected rows without a driver branch in the caller.
 */
const rowCountOf = (result: unknown): number => {
  if (Array.isArray(result)) return result.length;
  if (typeof result === 'object' && result !== null && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows.length;
  }
  return 0;
};

const staffGrantSchema = staffMemberSchema.pick({ id: true, userId: true, role: true });

export const createUserDirectory = (db: Db): UserDirectory => ({
  findByEmail: async (email) => {
    const rows = await db
      .select({ userId: user.id, email: user.email, name: user.name })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  },
});
