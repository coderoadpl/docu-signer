import { and, eq } from 'drizzle-orm';

import { tenantAccountSchema } from '#core/domain/index.js';
import type { TenantAccountRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { tenantAdmins, user } from './schema.js';

export const createTenantAccountRepository = (db: Db): TenantAccountRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select({ accountId: user.id, name: user.name })
      .from(tenantAdmins)
      .innerJoin(
        user,
        and(eq(user.id, tenantAdmins.userId), eq(tenantAdmins.tenantId, tenantId)),
      )
      .where(eq(tenantAdmins.tenantId, tenantId))
      .orderBy(user.name, user.id);
    return tenantAccountSchema.array().parse(rows);
  },
});
