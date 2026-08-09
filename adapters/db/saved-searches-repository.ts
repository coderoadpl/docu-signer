import { and, desc, eq } from 'drizzle-orm';

import {
  savedSearchFilterSchema,
  savedSearchSchema,
  type SavedSearch,
} from '#core/domain/index.js';
import type { SavedSearchRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { savedSearches } from './schema.js';

const toSavedSearch = (row: typeof savedSearches.$inferSelect): SavedSearch =>
  savedSearchSchema.parse({
    ...row,
    filter: savedSearchFilterSchema.parse(row.filter),
    createdAt: row.createdAt.toISOString(),
  });

export const createSavedSearchRepository = (db: Db): SavedSearchRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.tenantId, tenantId))
      .orderBy(desc(savedSearches.createdAt), desc(savedSearches.id));
    return rows.map(toSavedSearch);
  },
  create: async (input) => {
    const rows = await db.insert(savedSearches).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('Saved search insert returned no row');
    return toSavedSearch(row);
  },
  delete: async (tenantId, savedSearchId) => {
    const rows = await db
      .delete(savedSearches)
      .where(and(eq(savedSearches.tenantId, tenantId), eq(savedSearches.id, savedSearchId)))
      .returning({ id: savedSearches.id });
    return rows.length > 0;
  },
});
