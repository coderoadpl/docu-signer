import { eq } from 'drizzle-orm';

import { createAuth } from '#adapters/auth/create-auth.js';
import { seedEnvSchema } from '#core/server/config.js';

import { createDb } from './client.js';
import { configuredSeedAdmins, ensureSeedAdmins } from './seed-admins.js';
import { tenantAdmins, tenantDomains, tenants, user } from './schema.js';

const {
  DATABASE_URL: connectionString,
  DB_DRIVER: driver,
  BETTER_AUTH_SECRET,
  SEED_ADMIN1_EMAIL,
  SEED_ADMIN1_PASSWORD,
  SEED_ADMIN2_EMAIL,
  SEED_ADMIN2_PASSWORD,
} = seedEnvSchema.parse(process.env);

const db = createDb(driver, connectionString);
const auth = createAuth(db, {
  secret: BETTER_AUTH_SECRET,
  baseUrl: 'http://localhost:47100',
  baseDomain: 'localhost',
  trustedOrigins: () => ['http://localhost:47100'],
  secureCookies: false,
  rateLimitEnabled: false,
  disableSignUp: false,
  email: { sendMail: async () => {} },
});

const DEMO_EMAIL = 'demo@agentproofarch.dev';
const MAGIC_EMAIL = 'mag@example.com';

const existingDemo = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
if (existingDemo.length === 0) {
  await auth.api.signUpEmail({
    body: { name: 'Demo User', email: DEMO_EMAIL, password: 'demo1234' },
  });
}

await db
  .insert(user)
  .values({
    id: 'user-magic-link',
    name: 'Magic Link User',
    email: MAGIC_EMAIL,
    emailVerified: true,
  })
  .onConflictDoNothing();

const demoRows = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
const magicRows = await db.select().from(user).where(eq(user.email, MAGIC_EMAIL)).limit(1);
const demoUser = demoRows[0];
const magicUser = magicRows[0];
if (!demoUser || !magicUser) throw new Error('Seeded users not found');

await db
  .insert(tenants)
  .values({
    id: 'tenant-default',
    slug: 'default',
    name: 'Archiwum dokumentów',
    createdAt: new Date().toISOString(),
  })
  .onConflictDoNothing();

await db
  .insert(tenantAdmins)
  .values([
    {
      id: 'admin-default-demo',
      tenantId: 'tenant-default',
      userId: demoUser.id,
      role: 'owner',
    },
    {
      id: 'admin-default-magic',
      tenantId: 'tenant-default',
      userId: magicUser.id,
      role: 'admin',
    },
  ])
  .onConflictDoNothing();

await db
  .insert(tenantDomains)
  .values({
    id: 'domain-default-localhost',
    tenantId: 'tenant-default',
    domain: 'default.localhost',
    kind: 'subdomain',
    verified: true,
  })
  .onConflictDoNothing();

const configuredAdmins = configuredSeedAdmins({
  SEED_ADMIN1_EMAIL,
  SEED_ADMIN1_PASSWORD,
  SEED_ADMIN2_EMAIL,
  SEED_ADMIN2_PASSWORD,
});
const adminResults = await ensureSeedAdmins(db, configuredAdmins);

console.log('Seed applied:');
console.log(`  archive  ${DEMO_EMAIL}`);
console.log('  tenant   http://default.localhost:47100');
for (const result of adminResults) {
  console.log(`  archive  ${result.email} (${result.role}) ${result.status}`);
}
process.exit(0);
