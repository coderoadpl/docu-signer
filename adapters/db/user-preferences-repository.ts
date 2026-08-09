import { eq, and, sql } from 'drizzle-orm';

import {
  userPreferenceSchema,
  type UserPreference,
  type UserPreferenceValue,
} from '#core/domain/index.js';
import type { UserPreferenceRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { userPreferences } from './schema.js';

const toUserPreference = (row: typeof userPreferences.$inferSelect): UserPreference =>
  userPreferenceSchema.parse({
    userId: row.userId,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  });

export const createUserPreferenceRepository = (db: Db): UserPreferenceRepository => ({
  get: async (userId, key) => {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
      .limit(1);
    const row = rows[0];
    return row ? toUserPreference(row) : null;
  },
  set: async (userId, key, value: UserPreferenceValue) => {
    const rows = await db
      .insert(userPreferences)
      .values({ userId, key, value })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value, updatedAt: sql`now()` },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('User preference upsert returned no row');
    return toUserPreference(row);
  },
});
