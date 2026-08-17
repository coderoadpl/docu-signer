import { and, asc, eq } from 'drizzle-orm';

import {
  hiddenFilterValueSchema,
  type HiddenFilterValue,
} from '#core/domain/index.js';
import type { HiddenFilterValueRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { hiddenFilterValues } from './schema.js';

const toHiddenFilterValue = (
  row: typeof hiddenFilterValues.$inferSelect,
): HiddenFilterValue => hiddenFilterValueSchema.parse(row);

export const createHiddenFilterValueRepository = (db: Db): HiddenFilterValueRepository => ({
  listByTenant: async (tenantId) => {
    const rows = await db
      .select()
      .from(hiddenFilterValues)
      .where(eq(hiddenFilterValues.tenantId, tenantId))
      .orderBy(asc(hiddenFilterValues.kind), asc(hiddenFilterValues.value));
    return rows.map(toHiddenFilterValue);
  },
  hide: async (input) => {
    const inserted = await db
      .insert(hiddenFilterValues)
      .values(input)
      .onConflictDoNothing()
      .returning();
    const created = inserted[0];
    if (created) return toHiddenFilterValue(created);
    const existing = await db
      .select()
      .from(hiddenFilterValues)
      .where(
        and(
          eq(hiddenFilterValues.tenantId, input.tenantId),
          eq(hiddenFilterValues.kind, input.kind),
          eq(hiddenFilterValues.value, input.value),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) throw new Error('Hidden filter value insert returned no row');
    return toHiddenFilterValue(row);
  },
  unhide: async (tenantId, kind, value) => {
    const rows = await db
      .delete(hiddenFilterValues)
      .where(
        and(
          eq(hiddenFilterValues.tenantId, tenantId),
          eq(hiddenFilterValues.kind, kind),
          eq(hiddenFilterValues.value, value),
        ),
      )
      .returning({ id: hiddenFilterValues.id });
    return rows.length > 0;
  },
});
