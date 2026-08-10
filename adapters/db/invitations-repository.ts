import { and, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { invitationSchema, type Invitation } from '#core/domain/index.js';
import type { InvitationRepository, InvitationWithHash } from '#core/server/index.js';

import type { Db } from './client.js';
import { invitations, tenantAdmins, tenants, user } from './schema.js';

const toInvitation = (row: typeof invitations.$inferSelect): Invitation =>
  invitationSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    role: row.role,
    invitedBy: row.invitedBy,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  });

const returnedRowsSchema = z.union([
  z.object({ rows: z.array(z.object({ id: z.string() })) }),
  z.array(z.object({ id: z.string() })),
]);

const returnedRows = (value: unknown): Array<{ id: string }> => {
  const parsed = returnedRowsSchema.parse(value);
  return Array.isArray(parsed) ? parsed : parsed.rows;
};

export const createInvitationRepository = (db: Db): InvitationRepository => ({
  createOrReplace: async (input) => {
    const rows = await db
      .insert(invitations)
      .values({ ...input, expiresAt: new Date(input.expiresAt) })
      .onConflictDoUpdate({
        target: [invitations.tenantId, invitations.email],
        targetWhere: sql`${invitations.status} = 'pending'`,
        set: {
          id: input.id,
          role: input.role,
          tokenHash: input.tokenHash,
          invitedBy: input.invitedBy,
          expiresAt: new Date(input.expiresAt),
        },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Invitation insert returned no row');
    return toInvitation(row);
  },
  listByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .orderBy(invitations.email);
    return rows.map(toInvitation);
  },
  findByTokenHash: async (tokenHash) => {
    const rows = await db
      .select({ invitation: invitations, organizationName: tenants.name })
      .from(invitations)
      .innerJoin(tenants, eq(invitations.tenantId, tenants.id))
      .where(eq(invitations.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const invitation: InvitationWithHash = {
      ...toInvitation(row.invitation),
      tokenHash: row.invitation.tokenHash,
    };
    return { ...invitation, organizationName: row.organizationName };
  },
  hasAccount: async (email) => {
    const rows = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    return rows.length > 0;
  },
  accept: async (invitationId, userId) => {
    const result = await db.execute(sql`
      WITH accepted AS (
        UPDATE ${invitations}
        SET status = 'accepted'
        WHERE ${invitations.id} = ${invitationId}
          AND ${invitations.status} = 'pending'
        RETURNING tenant_id, role
      )
      INSERT INTO ${tenantAdmins} (id, tenant_id, user_id, role)
      SELECT 'invitation-' || ${invitationId}::text, tenant_id, ${userId}, role
      FROM accepted
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING id
    `);
    return returnedRows(result).length > 0;
  },
  revoke: async (tenantId, invitationId) => {
    const rows = await db
      .update(invitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(invitations.tenantId, tenantId),
          eq(invitations.id, invitationId),
          eq(invitations.status, 'pending'),
        ),
      )
      .returning({ id: invitations.id });
    return rows.length > 0;
  },
  expire: async (invitationId) => {
    await db
      .update(invitations)
      .set({ status: 'expired' })
      .where(and(eq(invitations.id, invitationId), eq(invitations.status, 'pending')));
  },
  expirePastDue: async (tenantId, now) => {
    await db
      .update(invitations)
      .set({ status: 'expired' })
      .where(
        and(
          eq(invitations.tenantId, tenantId),
          eq(invitations.status, 'pending'),
          lte(invitations.expiresAt, new Date(now)),
        ),
      );
  },
});
