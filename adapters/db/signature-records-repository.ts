import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import {
  signatureRecordPayloadSchema,
  signatureRecordSchema,
  type SignatureRecord,
} from '#core/domain/index.js';
import type { SignatureRecordRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { signatureRecords } from './schema.js';

const toSignatureRecord = (
  row: typeof signatureRecords.$inferSelect,
): SignatureRecord =>
  signatureRecordSchema.parse({
    ...row,
    payload: signatureRecordPayloadSchema.parse(row.payload),
    createdAt: row.createdAt.toISOString(),
  });

export const createSignatureRecordRepository = (
  db: Db,
): SignatureRecordRepository => ({
  listByDocument: async (tenantId, documentId, cursor, limit) => {
    const cursorCondition = cursor
      ? or(
          lt(signatureRecords.createdAt, new Date(cursor.createdAt)),
          and(
            eq(signatureRecords.createdAt, new Date(cursor.createdAt)),
            lt(signatureRecords.id, cursor.id),
          ),
        )
      : undefined;
    const rows = await db
      .select()
      .from(signatureRecords)
      .where(
        and(
          eq(signatureRecords.tenantId, tenantId),
          eq(signatureRecords.documentId, documentId),
          cursorCondition,
        ),
      )
      .orderBy(desc(signatureRecords.createdAt), desc(signatureRecords.id))
      .limit(limit);
    return rows.map(toSignatureRecord);
  },
  create: async (input) => {
    const rows = await db
      .insert(signatureRecords)
      .values(input)
      .onConflictDoNothing({
        target: signatureRecords.fileId,
        where: sql`${signatureRecords.replayedFromId} IS NULL`,
      })
      .returning();
    return rows[0] ? toSignatureRecord(rows[0]) : null;
  },
});
