import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './adapters/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch',
  },
});
