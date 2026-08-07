import { asc, eq } from 'drizzle-orm';

import type { __SINGULAR_PASCAL__Repository } from '#core/server/index.js';

import type { Db } from './client.js';
import { __PLURAL_CAMEL__ } from './schema.js';

export const create__SINGULAR_PASCAL__Repository = (db: Db): __SINGULAR_PASCAL__Repository => ({
  listByTenant: async (tenantId) =>
    db
      .select()
      .from(__PLURAL_CAMEL__)
      .where(eq(__PLURAL_CAMEL__.tenantId, tenantId))
      .orderBy(asc(__PLURAL_CAMEL__.createdAt)),
  create: async (__SINGULAR_CAMEL__) => {
    await db.insert(__PLURAL_CAMEL__).values(__SINGULAR_CAMEL__);
  },
});
