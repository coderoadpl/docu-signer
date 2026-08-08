import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { migrate as migrateNeonHttp } from 'drizzle-orm/neon-http/migrator';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { databaseEnvSchema } from '#core/server/config.js';

const { DATABASE_URL: connectionString, DB_DRIVER: driver } = databaseEnvSchema.parse(process.env);

if (driver === 'neon-http') {
  await migrateNeonHttp(drizzleNeonHttp(neon(connectionString)), { migrationsFolder: 'drizzle' });
} else {
  const pool = new pg.Pool({ connectionString });
  await migrateNodePg(drizzleNodePg(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
}
console.log('Migrations applied');
