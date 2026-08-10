import { and, asc, desc, eq, exists, inArray, sql } from 'drizzle-orm';

import {
  sourceUpdateApprovalSchema,
  sourceUpdateRequestSchema,
  type SourceUpdateApproval,
  type SourceUpdateRequest,
} from '#core/domain/index.js';
import type { SourceUpdateRequestRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import {
  sourceUpdateApprovals,
  sourceUpdateRequests,
} from './schema.js';

const toApproval = (
  row: typeof sourceUpdateApprovals.$inferSelect,
): SourceUpdateApproval => sourceUpdateApprovalSchema.parse(row);

const toRequest = (
  row: typeof sourceUpdateRequests.$inferSelect,
  approvals: SourceUpdateApproval[],
): SourceUpdateRequest => sourceUpdateRequestSchema.parse({ ...row, approvals });

const approvalsByRequest = async (
  db: Db,
  requestIds: string[],
): Promise<Map<string, SourceUpdateApproval[]>> => {
  if (requestIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(sourceUpdateApprovals)
    .where(inArray(sourceUpdateApprovals.requestId, requestIds))
    .orderBy(asc(sourceUpdateApprovals.approverId));
  const grouped = new Map<string, SourceUpdateApproval[]>();
  for (const row of rows) {
    const approvals = grouped.get(row.requestId) ?? [];
    approvals.push(toApproval(row));
    grouped.set(row.requestId, approvals);
  }
  return grouped;
};

const hydrate = async (
  db: Db,
  rows: Array<typeof sourceUpdateRequests.$inferSelect>,
): Promise<SourceUpdateRequest[]> => {
  const grouped = await approvalsByRequest(db, rows.map((row) => row.id));
  return rows.map((row) => toRequest(row, grouped.get(row.id) ?? []));
};

const findById = async (
  db: Db,
  tenantId: string,
  requestId: string,
): Promise<SourceUpdateRequest | null> => {
  const rows = await db
    .select()
    .from(sourceUpdateRequests)
    .where(
      and(
        eq(sourceUpdateRequests.tenantId, tenantId),
        eq(sourceUpdateRequests.id, requestId),
      ),
    )
    .limit(1);
  const requests = await hydrate(db, rows);
  return requests[0] ?? null;
};

export const createSourceUpdateRequestRepository = (
  db: Db,
): SourceUpdateRequestRepository => ({
  create: async (input) => {
    const inserted = await db
      .insert(sourceUpdateRequests)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        documentId: input.documentId,
        requestedBy: input.requestedBy,
        newSourceFileId: input.newSourceFileId,
        mode: input.mode,
      })
      .onConflictDoNothing()
      .returning({ id: sourceUpdateRequests.id });
    if (!inserted[0]) return null;
    if (input.approvalIds.length > 0) {
      await db.insert(sourceUpdateApprovals).values(
        input.approvalIds.map((approval) => ({
          id: approval.id,
          requestId: input.id,
          approverId: approval.approverId,
        })),
      );
    }
    return findById(db, input.tenantId, input.id);
  },
  findById: (tenantId, requestId) => findById(db, tenantId, requestId),
  findActiveByDocument: async (tenantId, documentId) => {
    const rows = await db
      .select()
      .from(sourceUpdateRequests)
      .where(
        and(
          eq(sourceUpdateRequests.tenantId, tenantId),
          eq(sourceUpdateRequests.documentId, documentId),
          eq(sourceUpdateRequests.status, 'pending'),
        ),
      )
      .limit(1);
    const requests = await hydrate(db, rows);
    return requests[0] ?? null;
  },
  listPendingByApprover: async (tenantId, approverId) => {
    const rows = await db
      .select()
      .from(sourceUpdateRequests)
      .where(
        and(
          eq(sourceUpdateRequests.tenantId, tenantId),
          eq(sourceUpdateRequests.status, 'pending'),
          exists(
            db
              .select({ id: sourceUpdateApprovals.id })
              .from(sourceUpdateApprovals)
              .where(
                and(
                  eq(sourceUpdateApprovals.requestId, sourceUpdateRequests.id),
                  eq(sourceUpdateApprovals.approverId, approverId),
                  eq(sourceUpdateApprovals.decision, 'pending'),
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(sourceUpdateRequests.createdAt), desc(sourceUpdateRequests.id));
    return hydrate(db, rows);
  },
  decide: async (tenantId, requestId, approverId, decision) => {
    const rows = await db
      .update(sourceUpdateApprovals)
      .set({ decision, decidedAt: new Date() })
      .where(
        and(
          eq(sourceUpdateApprovals.requestId, requestId),
          eq(sourceUpdateApprovals.approverId, approverId),
          eq(sourceUpdateApprovals.decision, 'pending'),
          exists(
            db
              .select({ id: sourceUpdateRequests.id })
              .from(sourceUpdateRequests)
              .where(
                and(
                  eq(sourceUpdateRequests.id, requestId),
                  eq(sourceUpdateRequests.tenantId, tenantId),
                  eq(sourceUpdateRequests.status, 'pending'),
                ),
              ),
          ),
        ),
      )
      .returning({ id: sourceUpdateApprovals.id });
    if (!rows[0]) return null;
    if (decision === 'rejected') {
      await db
        .update(sourceUpdateRequests)
        .set({
          status: 'rejected',
          resolvedBy: approverId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(sourceUpdateRequests.id, requestId),
            eq(sourceUpdateRequests.tenantId, tenantId),
            eq(sourceUpdateRequests.status, 'pending'),
          ),
        );
    }
    return findById(db, tenantId, requestId);
  },
  cancel: async (tenantId, requestId, requestedBy) => {
    const rows = await db
      .update(sourceUpdateRequests)
      .set({
        status: 'cancelled',
        resolvedBy: requestedBy,
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(sourceUpdateRequests.id, requestId),
          eq(sourceUpdateRequests.tenantId, tenantId),
          eq(sourceUpdateRequests.requestedBy, requestedBy),
          eq(sourceUpdateRequests.status, 'pending'),
        ),
      )
      .returning({ id: sourceUpdateRequests.id });
    return rows[0] ? findById(db, tenantId, requestId) : null;
  },
  complete: async (input) => {
    await db.execute(sql`
      WITH eligible AS (
        SELECT request.id, request.document_id, request.new_source_file_id
        FROM source_update_requests request
        WHERE request.id = ${input.requestId}
          AND request.tenant_id = ${input.tenantId}
          AND request.status = 'pending'
          AND NOT EXISTS (
            SELECT 1
            FROM source_update_approvals approval
            WHERE approval.request_id = request.id
              AND approval.decision <> 'accepted'
          )
          AND EXISTS (
            SELECT 1
            FROM document_files file
            WHERE file.id = request.new_source_file_id
              AND file.document_id = request.document_id
              AND file.role = 'other'
          )
          AND (
            ${input.signedFileId}::uuid IS NULL
            OR EXISTS (
              SELECT 1
              FROM document_files file
              WHERE file.id = ${input.signedFileId}::uuid
                AND file.document_id = request.document_id
                AND file.role = 'other'
            )
          )
      ),
      previous_files AS (
        SELECT file.id, file.role
        FROM document_files file
        JOIN eligible ON eligible.document_id = file.document_id
        WHERE file.role IN ('source', 'signed-digital')
      ),
      repointed_records AS (
        UPDATE signature_records record
        SET file_id = ${input.signedFileId}::uuid,
            replayed_from_id = COALESCE(record.replayed_from_id, record.id)
        WHERE ${input.signedFileId}::uuid IS NOT NULL
          AND record.tenant_id = ${input.tenantId}
          AND record.document_id = (SELECT document_id FROM eligible)
        RETURNING record.id
      ),
      deleted_files AS (
        DELETE FROM document_files file
        WHERE file.id IN (SELECT id FROM previous_files)
          AND (
            ${input.signedFileId}::uuid IS NULL
            OR (SELECT count(*) FROM repointed_records) >= 0
          )
        RETURNING file.id
      ),
      promoted_source AS (
        UPDATE document_files file
        SET role = 'source'
        WHERE file.id = (SELECT new_source_file_id FROM eligible)
          AND (SELECT count(*) FROM deleted_files) >= 0
        RETURNING file.id
      ),
      promoted_signed AS (
        UPDATE document_files file
        SET role = 'signed-digital'
        WHERE ${input.signedFileId}::uuid IS NOT NULL
          AND file.id = ${input.signedFileId}::uuid
          AND EXISTS (SELECT 1 FROM promoted_source)
        RETURNING file.id
      )
      UPDATE source_update_requests request
      SET status = 'completed',
          new_signed_file_id = ${input.signedFileId}::uuid,
          resolved_by = ${input.completedBy},
          resolved_at = now(),
          prior_source_file_ids = ARRAY(
            SELECT id FROM previous_files WHERE role = 'source' ORDER BY id
          ),
          prior_signed_file_ids = ARRAY(
            SELECT id FROM previous_files WHERE role = 'signed-digital' ORDER BY id
          )
      WHERE request.id = (SELECT id FROM eligible)
        AND EXISTS (SELECT 1 FROM promoted_source)
        AND (
          ${input.signedFileId}::uuid IS NULL
          OR EXISTS (SELECT 1 FROM promoted_signed)
        )
      RETURNING request.id
    `);
    const completed = await findById(db, input.tenantId, input.requestId);
    return completed?.status === 'completed' ? completed : null;
  },
});
