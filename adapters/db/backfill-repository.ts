import { eq, sql } from 'drizzle-orm';

import type { BackfillCheckpoint, BackfillPort } from '#core/server/index.js';

import type { Db } from './client.js';
import { backfillCheckpoints } from './schema.js';

export const createBackfillRepository = (db: Db): BackfillPort => ({
  loadCheckpoint: async (name) => {
    const rows = await db
      .select({
        name: backfillCheckpoints.name,
        cursor: backfillCheckpoints.cursor,
        processed: backfillCheckpoints.processed,
        done: backfillCheckpoints.done,
      })
      .from(backfillCheckpoints)
      .where(eq(backfillCheckpoints.name, name))
      .limit(1);
    return rows[0] ?? null;
  },
  saveCheckpoint: async (checkpoint: BackfillCheckpoint) => {
    await db
      .insert(backfillCheckpoints)
      .values({
        name: checkpoint.name,
        cursor: checkpoint.cursor,
        processed: checkpoint.processed,
        done: checkpoint.done,
      })
      .onConflictDoUpdate({
        target: backfillCheckpoints.name,
        set: {
          cursor: checkpoint.cursor,
          processed: checkpoint.processed,
          done: checkpoint.done,
          updatedAt: sql`now()`,
        },
      });
  },
});
