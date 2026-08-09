import { and, desc, eq } from 'drizzle-orm';

import {
  padSessionSchema,
  padSubmittedStrokesSchema,
  type PadSession,
  type PadSubmittedStrokes,
} from '#core/domain/index.js';
import type { PadSessionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { padSessions } from './schema.js';

const toPadSession = (row: typeof padSessions.$inferSelect): PadSession =>
  padSessionSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    currentRequest: row.currentRequest ?? null,
    submittedStrokes: row.submittedStrokes ?? null,
  });

const toSubmittedStrokes = (value: unknown): PadSubmittedStrokes =>
  padSubmittedStrokesSchema.parse(value);

export const createPadSessionRepository = (db: Db): PadSessionRepository => ({
  create: async (input) => {
    return db.transaction(async (transaction) => {
      await transaction
        .update(padSessions)
        .set({ status: 'closed', currentRequest: null, submittedStrokes: null })
        .where(
          and(
            eq(padSessions.tenantId, input.tenantId),
            eq(padSessions.createdBy, input.createdBy),
            eq(padSessions.status, 'active'),
          ),
        );
      const rows = await transaction
        .insert(padSessions)
        .values({
          ...input,
          expiresAt: new Date(input.expiresAt),
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('Pad session insert returned no row');
      return toPadSession(row);
    });
  },
  findById: async (tenantId, sessionId) => {
    const rows = await db
      .select()
      .from(padSessions)
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .limit(1);
    return rows[0] ? toPadSession(rows[0]) : null;
  },
  findActiveByUser: async (tenantId, userId) => {
    const rows = await db
      .select()
      .from(padSessions)
      .where(
        and(
          eq(padSessions.tenantId, tenantId),
          eq(padSessions.createdBy, userId),
          eq(padSessions.status, 'active'),
        ),
      )
      .orderBy(desc(padSessions.createdAt))
      .limit(1);
    return rows[0] ? toPadSession(rows[0]) : null;
  },
  renew: async (tenantId, sessionId, expiresAt, lastPolledAt) => {
    const rows = await db
      .update(padSessions)
      .set({ expiresAt: new Date(expiresAt), lastPolledAt: new Date(lastPolledAt) })
      .where(
        and(
          eq(padSessions.tenantId, tenantId),
          eq(padSessions.id, sessionId),
          eq(padSessions.status, 'active'),
        ),
      )
      .returning();
    return rows[0] ? toPadSession(rows[0]) : null;
  },
  requestSignature: async (tenantId, sessionId, request) => {
    const rows = await db
      .update(padSessions)
      .set({ currentRequest: request, submittedStrokes: null })
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .returning();
    return rows[0] ? toPadSession(rows[0]) : null;
  },
  submitStrokes: async (tenantId, sessionId, strokes) => {
    const rows = await db
      .update(padSessions)
      .set({ submittedStrokes: strokes })
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .returning();
    return rows[0] ? toPadSession(rows[0]) : null;
  },
  consumeStrokes: async (tenantId, sessionId) => {
    const rows = await db
      .select({ submittedStrokes: padSessions.submittedStrokes })
      .from(padSessions)
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .limit(1);
    const submitted = rows[0]?.submittedStrokes;
    if (!submitted) return null;
    await db
      .update(padSessions)
      .set({ submittedStrokes: null, currentRequest: null })
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)));
    return toSubmittedStrokes(submitted);
  },
  close: async (tenantId, sessionId) => {
    const rows = await db
      .update(padSessions)
      .set({ status: 'closed', currentRequest: null, submittedStrokes: null })
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .returning({ id: padSessions.id });
    return rows.length > 0;
  },
});
