import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { migrate as migrateNeonHttp } from 'drizzle-orm/neon-http/migrator';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

// Mirrors env.ts: neon-http on Vercel (build-time migrations hit Neon over HTTP),
// node-postgres everywhere else. Explicit DB_DRIVER wins.
const driver = process.env['DB_DRIVER'] ?? (process.env['VERCEL'] ? 'neon-http' : 'node-postgres');

if (driver === 'neon-http') {
  await migrateNeonHttp(drizzleNeonHttp(neon(connectionString)), { migrationsFolder: 'drizzle' });
} else {
  const pool = new pg.Pool({ connectionString });
  await migrateNodePg(drizzleNodePg(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
}
console.log('Migrations applied');
