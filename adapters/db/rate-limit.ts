import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { RateLimitPort } from '#core/server/index.js';

import type { Db } from './client.js';
import { rateLimit } from './schema.js';

export const createRateLimitPort = (db: Db): RateLimitPort => ({
  consume: async (key, max, windowSeconds) => {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const rows = await db
      .insert(rateLimit)
      .values({ id: randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`CASE WHEN ${rateLimit.lastRequest} <= ${cutoff} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: sql`CASE WHEN ${rateLimit.lastRequest} <= ${cutoff} THEN ${now} ELSE ${rateLimit.lastRequest} END`,
        },
      })
      .returning({ count: rateLimit.count });
    return (rows[0]?.count ?? max + 1) <= max;
  },
});
