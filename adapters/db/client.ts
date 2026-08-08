import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';

import * as schema from './schema.js';

export type DbDriver = 'node-postgres' | 'neon-http';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface StandaloneDb {
  readonly db: Db;
  readonly close: () => Promise<void>;
}

/**
 * The only place the concrete Postgres driver is chosen.
 * `node-postgres` — long-lived processes (Docker, local dev).
 * `neon-http`     — serverless (Vercel Functions), no connection pool to exhaust.
 */
export const createDb = (driver: DbDriver, connectionString: string): Db => {
  switch (driver) {
    case 'neon-http':
      return drizzleNeonHttp(neon(connectionString), { schema });
    case 'node-postgres':
      return drizzleNodePg(new pg.Pool({ connectionString }), { schema });
  }
};

export const createStandaloneDb = (
  driver: DbDriver,
  connectionString: string,
): StandaloneDb => {
  switch (driver) {
    case 'neon-http':
      return {
        db: drizzleNeonHttp(neon(connectionString), { schema }),
        close: () => Promise.resolve(),
      };
    case 'node-postgres': {
      const pool = new pg.Pool({ connectionString });
      return {
        db: drizzleNodePg(pool, { schema }),
        close: () => pool.end(),
      };
    }
  }
};
