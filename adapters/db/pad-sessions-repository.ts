import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';

import {
  padSessionSchema,
  padParticipantSchema,
  padQueuedSubmissionSchema,
  padSubmittedStrokesSchema,
  type PadSession,
  type PadParticipant,
  type PadQueuedSubmission,
  type PadSubmittedStrokes,
} from '#core/domain/index.js';
import type { PadSessionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { padSessionParticipants, padSessionSubmissions, padSessions } from './schema.js';

const toPadSession = (row: typeof padSessions.$inferSelect): PadSession =>
  padSessionSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    currentRequest: row.currentRequest ?? null,
    currentDocument: row.currentDocument ?? null,
    submittedStrokes: row.submittedStrokes ?? null,
  });

const toSubmittedStrokes = (value: unknown): PadSubmittedStrokes =>
  padSubmittedStrokesSchema.parse(value);

const toParticipant = (
  row: typeof padSessionParticipants.$inferSelect,
): PadParticipant =>
  padParticipantSchema.parse({
    accountId: row.accountId,
    label: row.label,
    lastPolledAt: row.lastPolledAt.toISOString(),
  });

const toQueuedSubmission = (
  row: typeof padSessionSubmissions.$inferSelect,
): PadQueuedSubmission =>
  padQueuedSubmissionSchema.parse({
    id: row.id,
    requestId: row.requestId,
    document: row.document,
    strokes: row.strokes,
    inkColor: row.inkColor,
    sourceSize: row.sourceSize,
    contributedBy: {
      accountId: row.contributorAccountId,
      label: row.contributorLabel,
    },
    createdAt: row.createdAt.toISOString(),
  });

export const createPadSessionRepository = (db: Db): PadSessionRepository => ({
  create: async (input) => {
    // WHY: neon-http cannot wrap supersede, transient cleanup and insert in an
    // interactive transaction; the partial unique index remains the authority
    // for the host's single active slot if concurrent creates race.
    const superseded = await db
      .update(padSessions)
      .set({
        status: 'closed',
        currentDocument: null,
        currentRequest: null,
        submittedStrokes: null,
      })
      .where(
        and(
          eq(padSessions.tenantId, input.tenantId),
          eq(padSessions.createdBy, input.createdBy),
          eq(padSessions.status, 'active'),
        ),
      )
      .returning({ id: padSessions.id });
    const supersededIds = superseded.map(({ id }) => id);
    if (supersededIds.length > 0) {
      await db
        .delete(padSessionParticipants)
        .where(inArray(padSessionParticipants.sessionId, supersededIds));
      await db
        .delete(padSessionSubmissions)
        .where(inArray(padSessionSubmissions.sessionId, supersededIds));
    }
    const rows = await db
      .insert(padSessions)
      .values({
        ...input,
        expiresAt: new Date(input.expiresAt),
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Pad session insert returned no row');
    return toPadSession(row);
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
  findActiveShared: async (tenantId, excludeUserId) => {
    const rows = await db
      .select()
      .from(padSessions)
      .where(
        and(
          eq(padSessions.tenantId, tenantId),
          ne(padSessions.createdBy, excludeUserId),
          eq(padSessions.mode, 'shared'),
          eq(padSessions.status, 'active'),
          gt(padSessions.expiresAt, new Date()),
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
  setCurrentDocument: async (tenantId, sessionId, document) => {
    const rows = await db
      .update(padSessions)
      .set({ currentDocument: document })
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
  touchParticipant: async (tenantId, sessionId, participant) => {
    await db
      .insert(padSessionParticipants)
      .values({
        ...participant,
        tenantId,
        sessionId,
        lastPolledAt: new Date(participant.lastPolledAt),
      })
      .onConflictDoUpdate({
        target: [padSessionParticipants.sessionId, padSessionParticipants.accountId],
        set: {
          label: participant.label,
          lastPolledAt: new Date(participant.lastPolledAt),
        },
      });
  },
  listParticipants: async (tenantId, sessionId) => {
    const rows = await db
      .select()
      .from(padSessionParticipants)
      .where(
        and(
          eq(padSessionParticipants.tenantId, tenantId),
          eq(padSessionParticipants.sessionId, sessionId),
        ),
      )
      .orderBy(asc(padSessionParticipants.label));
    return rows.map(toParticipant);
  },
  removeParticipant: async (tenantId, sessionId, accountId) => {
    const rows = await db
      .delete(padSessionParticipants)
      .where(
        and(
          eq(padSessionParticipants.tenantId, tenantId),
          eq(padSessionParticipants.sessionId, sessionId),
          eq(padSessionParticipants.accountId, accountId),
        ),
      )
      .returning({ id: padSessionParticipants.id });
    return rows.length > 0;
  },
  enqueueSubmission: async (tenantId, sessionId, submission) => {
    await db.insert(padSessionSubmissions).values({
      id: submission.id,
      tenantId,
      sessionId,
      requestId: submission.requestId,
      document: submission.document,
      strokes: submission.strokes,
      inkColor: submission.inkColor,
      sourceSize: submission.sourceSize,
      contributorAccountId: submission.contributedBy.accountId,
      contributorLabel: submission.contributedBy.label,
      createdAt: new Date(submission.createdAt),
    });
    if (submission.requestId) {
      await db
        .update(padSessions)
        .set({ currentRequest: null })
        .where(
          and(
            eq(padSessions.tenantId, tenantId),
            eq(padSessions.id, sessionId),
            sql`${padSessions.currentRequest}->>'requestId' = ${submission.requestId}`,
          ),
        );
    }
  },
  listSubmissions: async (tenantId, sessionId) => {
    const rows = await db
      .select()
      .from(padSessionSubmissions)
      .where(
        and(
          eq(padSessionSubmissions.tenantId, tenantId),
          eq(padSessionSubmissions.sessionId, sessionId),
        ),
      )
      .orderBy(asc(padSessionSubmissions.createdAt), asc(padSessionSubmissions.id));
    return rows.map(toQueuedSubmission);
  },
  consumeSubmission: async (tenantId, sessionId, submissionId) => {
    const rows = await db
      .delete(padSessionSubmissions)
      .where(
        and(
          eq(padSessionSubmissions.tenantId, tenantId),
          eq(padSessionSubmissions.sessionId, sessionId),
          eq(padSessionSubmissions.id, submissionId),
        ),
      )
      .returning();
    return rows[0] ? toQueuedSubmission(rows[0]) : null;
  },
  close: async (tenantId, sessionId) => {
    const rows = await db
      .update(padSessions)
      .set({
        status: 'closed',
        currentDocument: null,
        currentRequest: null,
        submittedStrokes: null,
      })
      .where(and(eq(padSessions.tenantId, tenantId), eq(padSessions.id, sessionId)))
      .returning({ id: padSessions.id });
    await db
      .delete(padSessionParticipants)
      .where(
        and(
          eq(padSessionParticipants.tenantId, tenantId),
          eq(padSessionParticipants.sessionId, sessionId),
        ),
      );
    await db
      .delete(padSessionSubmissions)
      .where(
        and(
          eq(padSessionSubmissions.tenantId, tenantId),
          eq(padSessionSubmissions.sessionId, sessionId),
        ),
      );
    return rows.length > 0;
  },
});
