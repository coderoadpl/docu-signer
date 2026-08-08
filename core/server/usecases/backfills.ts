import { err, notFound, ok, type AppError, type Result } from '#core/domain/index.js';

import type { BackfillPort, BatchOutcome } from '../ports.js';

/**
 * A registered backfill (§Backfills, DECIDE C4). Named, idempotent, and
 * batch-bounded: `runBatch` processes at most `limit` rows from `cursor` and
 * reports where the next batch resumes. The executor owns the checkpoint; a job
 * only knows how to advance one page.
 */
export interface BackfillJob {
  readonly name: string;
  runBatch(port: BackfillPort, cursor: string | null, limit: number): Promise<BatchOutcome>;
}

/**
 * The code-defined registry — the ONLY backfills that can run. Adding a backfill
 * is a reviewed code change here, never an ad-hoc production script (owner C4:
 * "deweloper ani agent nigdy nie działa bezpośrednio na produkcji"). The demo
 * entry is a no-op normalisation re-stamp (idempotent email lowercasing).
 */
export const BACKFILLS: Readonly<Record<string, BackfillJob>> = {
  'members-email-normalize': {
    name: 'members-email-normalize',
    runBatch: (port, cursor, limit) => port.normalizeMemberEmails(cursor, limit),
  },
};

export interface BackfillProgress {
  readonly name: string;
  readonly processed: number;
  readonly done: boolean;
}

export const backfillNames = (): string[] => Object.keys(BACKFILLS);

/**
 * Executor for one batch of a named backfill. Loads the checkpoint, runs one
 * bounded page, and persists the advanced checkpoint — so repeated invocations
 * (a cron hitting the endpoint) drive the backfill to completion and then
 * short-circuit once `done`. A system operation, not tenant-scoped: it carries no
 * capability and is gated by network isolation / a shared secret at the edge, not
 * by identity (like the domain-check control plane).
 */
export const runBackfillBatch = async (
  name: string,
  limit: number,
  deps: { backfills: BackfillPort },
): Promise<Result<BackfillProgress, AppError>> => {
  const job = BACKFILLS[name];
  if (!job) return err(notFound(`No backfill named "${name}"`));

  const existing = await deps.backfills.loadCheckpoint(name);
  if (existing?.done) return ok({ name, processed: existing.processed, done: true });

  const cursor = existing?.cursor ?? null;
  const outcome = await job.runBatch(deps.backfills, cursor, limit);
  const processed = (existing?.processed ?? 0) + outcome.processed;

  await deps.backfills.saveCheckpoint({ name, cursor: outcome.nextCursor, processed, done: outcome.done });
  return ok({ name, processed, done: outcome.done });
};
