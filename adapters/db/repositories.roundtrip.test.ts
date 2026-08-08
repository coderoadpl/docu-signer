import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createTenantRepository } from './repositories.js';
import * as schema from './schema.js';

/**
 * C1 atomicity proof (§Transactions): `createTenantWithOwner` must reach the
 * driver in exactly ONE round-trip so tenant + owner are inserted atomically.
 * We wrap a real drizzle db, stub `execute` (never connecting) and assert it is
 * called exactly once — a regression that splits the CTE into two statements, or
 * reverts to two `insert()` calls, makes this count wrong and fails the gate.
 */

const pool = new pg.Pool({ connectionString: 'postgresql://probe:probe@127.0.0.1:1/probe' });
const db = drizzleNodePg(pool, { schema });

afterAll(async () => {
  await pool.end();
});

describe('createTenantWithOwner atomicity', () => {
  it('reaches the driver in a single execute() round-trip', async () => {
    const execute = vi
      .spyOn(db, 'execute')
      .mockResolvedValue({ command: 'INSERT', rowCount: 1, oid: 0, rows: [], fields: [] });

    const repo = createTenantRepository(db);
    const tenant = await repo.createTenantWithOwner({
      tenant: { id: 't-1', slug: 'acme', name: 'Acme', createdAt: '2026-07-21T00:00:00.000Z' },
      ownerGrant: { id: 'g-1', userId: 'u-1' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(tenant).toEqual({ id: 't-1', slug: 'acme', name: 'Acme' });
  });
});
