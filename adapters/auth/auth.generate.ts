/**
 * Standalone config consumed ONLY by `@better-auth/cli generate` to produce
 * `adapters/db/auth-schema.ts`. Never connects to a database. The runtime
 * auth instance lives in `create-auth.ts`; keep the plugin list in sync.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export const auth = betterAuth({
  database: drizzleAdapter(
    drizzle(new pg.Pool({ connectionString: 'postgresql://generate:generate@127.0.0.1:1/generate' })),
    { provider: 'pg' },
  ),
  secret: 'generate-only-secret',
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [bearer()],
});
