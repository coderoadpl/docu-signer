import { and, asc, eq } from 'drizzle-orm';

import { cardSchema } from '#core/domain/index.js';
import type { CardRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { cards } from './schema.js';

export const createCardRepository = (db: Db): CardRepository => ({
  // Parse at the boundary (C3 invariant matrix): a corrupted card row (an
  // out-of-range position, a non-board value the DB check somehow missed) is
  // rejected LOUDLY here rather than flowing untyped into the use-cases.
  listByTenant: async (tenantId, board) => {
    const rows = await db
      .select()
      .from(cards)
      .where(and(eq(cards.tenantId, tenantId), eq(cards.board, board)))
      .orderBy(asc(cards.column), asc(cards.position));
    return rows.map((row) => cardSchema.parse(row));
  },
  create: async (card) => {
    await db.insert(cards).values(card);
  },
  // Positions are rewritten row-by-row scoped to the tenant + board. Sequential
  // (not a db.transaction) so the same code runs under neon-http, which has no
  // interactive transactions; the use-case re-clamps on every read, and a
  // transient partial reorder is tolerated. `visited` is written only when the
  // update carries it (the moving card), so the reorder pass leaves other
  // cards' history untouched.
  updatePositions: async (tenantId, board, updates) => {
    for (const update of updates) {
      await db
        .update(cards)
        .set({
          column: update.column,
          position: update.position,
          ...(update.visited === undefined ? {} : { visited: [...update.visited] }),
        })
        .where(
          and(eq(cards.id, update.id), eq(cards.tenantId, tenantId), eq(cards.board, board)),
        );
    }
  },
});
