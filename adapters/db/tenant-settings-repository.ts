import { eq } from 'drizzle-orm';

import {
  tenantSettingsSchema,
  type TenantSettings,
} from '#core/domain/index.js';
import type { TenantSettingsRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { tenantSettings } from './schema.js';

const toTenantSettings = (
  row: typeof tenantSettings.$inferSelect,
): TenantSettings => tenantSettingsSchema.parse(row);

export const createTenantSettingsRepository = (
  db: Db,
): TenantSettingsRepository => ({
  get: async (tenantId) => {
    const rows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId))
      .limit(1);
    return rows[0] ? toTenantSettings(rows[0]) : null;
  },
  set: async (tenantId, settings) => {
    const rows = await db
      .insert(tenantSettings)
      .values({ tenantId, ...settings })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: settings,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Tenant settings upsert returned no row');
    return toTenantSettings(row);
  },
});
