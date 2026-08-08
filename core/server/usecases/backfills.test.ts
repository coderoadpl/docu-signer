import { describe, expect, it, vi } from 'vitest';

import type { BackfillCheckpoint, BackfillPort, BatchOutcome } from '../ports.js';
import { backfillNames, runBackfillBatch } from './backfills.js';

const NAME = 'members-email-normalize';

const fakePort = (
  over: Partial<BackfillPort> & { batches?: BatchOutcome[] } = {},
): { port: BackfillPort; saved: BackfillCheckpoint[] } => {
  const saved: BackfillCheckpoint[] = [];
  const batches = over.batches ?? [];
  let call = 0;
  const port: BackfillPort = {
    loadCheckpoint: over.loadCheckpoint ?? (async () => null),
    saveCheckpoint:
      over.saveCheckpoint ??
      (async (checkpoint) => {
        saved.push(checkpoint);
      }),
    normalizeMemberEmails:
      over.normalizeMemberEmails ??
      (async () => batches[call++] ?? { processed: 0, nextCursor: null, done: true }),
  };
  return { port, saved };
};

describe('runBackfillBatch', () => {
  it('exposes the demo backfill in the registry', () => {
    expect(backfillNames()).toContain(NAME);
  });

  it('returns not_found for an unregistered name and never touches the port', async () => {
    const { port, saved } = fakePort();
    const load = vi.spyOn(port, 'loadCheckpoint');
    const result = await runBackfillBatch('no-such-backfill', 100, { backfills: port });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
    expect(load).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('runs a fresh batch from a null cursor and persists the advanced checkpoint', async () => {
    const { port, saved } = fakePort({
      batches: [{ processed: 2, nextCursor: 'id-2', done: false }],
    });
    const result = await runBackfillBatch(NAME, 2, { backfills: port });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: NAME, processed: 2, done: false });
    expect(saved).toEqual([{ name: NAME, cursor: 'id-2', processed: 2, done: false }]);
  });

  it('resumes from an existing checkpoint, accumulating the processed total', async () => {
    const { port, saved } = fakePort({
      loadCheckpoint: async () => ({ name: NAME, cursor: 'id-2', processed: 2, done: false }),
      normalizeMemberEmails: async (cursor) => {
        expect(cursor).toBe('id-2');
        return { processed: 3, nextCursor: null, done: true };
      },
    });
    const result = await runBackfillBatch(NAME, 100, { backfills: port });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: NAME, processed: 5, done: true });
    expect(saved).toEqual([{ name: NAME, cursor: null, processed: 5, done: true }]);
  });

  it('short-circuits a completed backfill without running or re-saving it', async () => {
    const { port, saved } = fakePort({
      loadCheckpoint: async () => ({ name: NAME, cursor: null, processed: 9, done: true }),
    });
    const run = vi.spyOn(port, 'normalizeMemberEmails');
    const result = await runBackfillBatch(NAME, 100, { backfills: port });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: NAME, processed: 9, done: true });
    expect(run).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});
