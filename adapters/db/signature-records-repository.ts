import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

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
    seal: row.sealSubject && row.sealDeclaredAt && row.sealAppliedAt
      ? {
          subject: row.sealSubject,
          declaredAt: row.sealDeclaredAt.toISOString(),
          appliedAt: row.sealAppliedAt.toISOString(),
        }
      : null,
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
          isNotNull(signatureRecords.payload),
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
      .onConflictDoUpdate({
        target: signatureRecords.fileId,
        targetWhere: sql`${signatureRecords.replayedFromId} IS NULL`,
        set: { payload: input.payload, signedBy: input.signedBy },
        setWhere: isNull(signatureRecords.payload),
      })
      .returning();
    return rows[0] ? toSignatureRecord(rows[0]) : null;
  },
  recordSeal: async (input) => {
    const sealValues = {
      sealSubject: input.seal.subject,
      sealDeclaredAt: new Date(input.seal.declaredAt),
      sealAppliedAt: new Date(input.seal.appliedAt),
    };
    const updated = await db
      .update(signatureRecords)
      .set(sealValues)
      .where(
        and(
          eq(signatureRecords.tenantId, input.tenantId),
          eq(signatureRecords.documentId, input.documentId),
          eq(signatureRecords.fileId, input.fileId),
        ),
      )
      .returning({ id: signatureRecords.id });
    if (updated.length > 0) return;
    await db
      .insert(signatureRecords)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        documentId: input.documentId,
        fileId: input.fileId,
        signedBy: input.signedBy,
        payload: null,
        ...sealValues,
      })
      .onConflictDoUpdate({
        target: signatureRecords.fileId,
        targetWhere: sql`${signatureRecords.replayedFromId} IS NULL`,
        set: sealValues,
      });
  },
});
