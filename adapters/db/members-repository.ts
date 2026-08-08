import { and, asc, eq } from 'drizzle-orm';

import { memberSchema, type Member } from '#core/domain/index.js';
import type { MemberRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { members } from './schema.js';

// Parse every row back through the domain schema at the adapter boundary: the
// `marketing_consents` jsonb is stored as an untyped channel string, so the
// schema is what narrows it to the `MarketingChannel` union the core relies on.
const toMember = (row: typeof members.$inferSelect): Member => memberSchema.parse(row);

export const createMemberRepository = (db: Db): MemberRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(members)
      .where(eq(members.tenantId, tenantId))
      .orderBy(asc(members.createdAt));
    return rows.map(toMember);
  },
  findByEmail: async (tenantId, email) => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.email, email)))
      .limit(1);
    return rows[0] ? toMember(rows[0]) : null;
  },
  findByTenantAndId: async (tenantId, id) => {
    const rows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, id)))
      .limit(1);
    return rows[0] ? toMember(rows[0]) : null;
  },
  create: async (member) => {
    await db.insert(members).values(member);
  },
  update: async (member) => {
    await db
      .update(members)
      .set({
        userId: member.userId,
        email: member.email,
        displayName: member.displayName,
        tags: member.tags,
        marketingConsents: member.marketingConsents,
        externalCustomerIds: member.externalCustomerIds,
        lastSeenAt: member.lastSeenAt,
      })
      .where(and(eq(members.tenantId, member.tenantId), eq(members.id, member.id)));
  },
  deleteByTenantAndId: async (tenantId, id) => {
    const deleted = await db
      .delete(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, id)))
      .returning({ id: members.id });
    return deleted.length;
  },
});
