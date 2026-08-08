import { eq, sql } from 'drizzle-orm';

import type { BackfillCheckpoint, BackfillPort, BatchOutcome } from '#core/server/index.js';

import type { Db } from './client.js';
import { backfillCheckpoints } from './schema.js';

const idsOf = (result: unknown): string[] => {
  const rows = Array.isArray(result)
    ? result
    : typeof result === 'object' && result !== null && 'rows' in result && Array.isArray(result.rows)
      ? result.rows
      : [];
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string') {
      ids.push(row.id);
    }
  }
  return ids;
};

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
  // One idempotent page: lowercase the emails of the next `limit` members ordered
  // by id, advancing the cursor to the greatest id touched. `done` when the page
  // was not full (no rows remain past the cursor).
  normalizeMemberEmails: async (cursor, limit): Promise<BatchOutcome> => {
    const result = await db.execute(sql`
      WITH page AS (
        SELECT id FROM members
        WHERE ${cursor === null ? sql`true` : sql`id > ${cursor}`}
        ORDER BY id
        LIMIT ${limit}
      )
      UPDATE members m SET email = lower(m.email)
      FROM page WHERE m.id = page.id
      RETURNING m.id
    `);
    const ids = idsOf(result);
    const processed = ids.length;
    const nextCursor = processed > 0 ? ids.reduce((a, b) => (b > a ? b : a)) : cursor;
    return { processed, nextCursor, done: processed < limit };
  },
});
