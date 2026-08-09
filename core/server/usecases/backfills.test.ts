import { describe, expect, it } from 'vitest';

import type { BackfillPort } from '../ports.js';
import { backfillNames, runBackfillBatch } from './backfills.js';

const port: BackfillPort = {
  loadCheckpoint: async () => null,
  saveCheckpoint: async () => {},
};

describe('backfill registry', () => {
  it('contains no demo jobs', () => {
    expect(backfillNames()).toEqual([]);
  });

  it('returns not_found for every unregistered name', async () => {
    const result = await runBackfillBatch('removed-demo-job', 100, { backfills: port });
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
