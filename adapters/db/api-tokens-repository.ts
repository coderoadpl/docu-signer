import { and, eq, isNull, sql } from 'drizzle-orm';

import { apiTokenSchema, type ApiToken } from '#core/domain/index.js';
import type { ApiTokenIdentity, ApiTokenRepository, ApiTokenWithHash } from '#core/server/index.js';

import type { Db } from './client.js';
import { apiTokens, user } from './schema.js';

const toApiToken = (row: typeof apiTokens.$inferSelect): ApiToken =>
  apiTokenSchema.parse({
    id: row.id,
    userId: row.userId,
    name: row.name,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });

const toApiTokenWithHash = (row: typeof apiTokens.$inferSelect): ApiTokenWithHash => ({
  ...toApiToken(row),
  tokenHash: row.tokenHash,
});

export const createApiTokenRepository = (db: Db): ApiTokenRepository => ({
  create: async (input) => {
    const rows = await db.insert(apiTokens).values(input).returning();
    const row = rows[0];
    if (!row) throw new Error('API token insert returned no row');
    return toApiToken(row);
  },
  listByUser: async (userId) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(apiTokens.createdAt);
    return rows.map(toApiToken);
  },
  findActiveByHash: async (tokenHash) => {
    const rows = await db
      .select({ token: apiTokens, owner: user })
      .from(apiTokens)
      .innerJoin(user, eq(apiTokens.userId, user.id))
      .where(eq(apiTokens.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    if (!row || row.token.revokedAt !== null) return null;
    const identity: ApiTokenIdentity = {
      token: toApiTokenWithHash(row.token),
      user: {
        userId: row.owner.id,
        email: row.owner.email,
        name: row.owner.name,
      },
    };
    return identity;
  },
  markUsed: async (apiTokenId) => {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiTokens.id, apiTokenId));
  },
  revoke: async (userId, apiTokenId) => {
    const rows = await db
      .update(apiTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.userId, userId),
          eq(apiTokens.id, apiTokenId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    return rows.length > 0;
  },
});
