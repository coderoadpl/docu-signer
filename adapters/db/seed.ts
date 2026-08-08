/**
 * Demo seed: one user who belongs to two tenants, each with its own todos.
 *   email:    demo@agentproofarch.dev
 *   password: demo1234
 * Tenants: acme.localhost and globex.localhost (subdomains of APP_BASE_DOMAIN).
 * Idempotent: running twice is a no-op.
 */
import { eq } from 'drizzle-orm';

import { createAuth } from '#adapters/auth/create-auth.js';
import { seedEnvSchema } from '#core/server/config.js';

import { createDb } from './client.js';
import { members, tenantAdmins, tenantDomains, tenants, todos, user } from './schema.js';

const { DATABASE_URL: connectionString, BETTER_AUTH_SECRET } = seedEnvSchema.parse(process.env);

const db = createDb('node-postgres', connectionString);

const auth = createAuth(db, {
  secret: BETTER_AUTH_SECRET,
  baseUrl: 'http://localhost:47100',
  baseDomain: 'localhost',
  trustedOrigins: () => ['http://localhost:47100'],
  secureCookies: false,
  rateLimitEnabled: false,
  // The seed signs up the demo user by password (no email is sent), so a
  // no-op sink satisfies the auth wiring without pulling in a live relay.
  email: { sendMail: async () => {} },
});

const DEMO_EMAIL = 'demo@agentproofarch.dev';

const existing = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
if (existing.length === 0) {
  await auth.api.signUpEmail({
    body: { name: 'Demo User', email: DEMO_EMAIL, password: 'demo1234' },
  });
}
const seededUsers = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
const demoUser = seededUsers[0];
if (!demoUser) throw new Error('Seeded user not found');

const seededAt = Date.now();
const nowIso = new Date(seededAt).toISOString();

const tenantRows = [
  { id: 'tenant-acme', slug: 'acme', name: 'Acme Sp. z o.o.' },
  { id: 'tenant-globex', slug: 'globex', name: 'Globex Corp' },
];

await db.insert(tenants).values(tenantRows.map((tenant) => ({ ...tenant, createdAt: nowIso }))).onConflictDoNothing();

await db.insert(tenantAdmins).values(
  tenantRows.map((tenant, index) => ({
    id: `admin-${tenant.slug}`,
    tenantId: tenant.id,
    userId: demoUser.id,
    role: index === 0 ? ('owner' as const) : ('admin' as const),
  })),
).onConflictDoNothing();

await db.insert(members).values([
  {
    id: 'member-acme-alice',
    tenantId: 'tenant-acme',
    userId: 'customer-alice-opaque',
    email: 'alice@example.com',
    displayName: 'Alice Example',
    tags: ['vip', 'early-adopter'],
    marketingConsents: [{ channel: 'email', granted: true, updatedAt: nowIso }],
    externalCustomerIds: ['cus_acme_alice'],
    createdAt: nowIso,
    lastSeenAt: nowIso,
  },
  {
    // US-026: a passwordless provisioned member (no account yet). Its userId
    // binds on first magic-link sign-in into acme.localhost.
    id: 'member-acme-mag',
    tenantId: 'tenant-acme',
    userId: null,
    email: 'mag@example.com',
    displayName: 'Magic Link Member',
    tags: ['provisioned'],
    marketingConsents: [],
    externalCustomerIds: [],
    createdAt: nowIso,
    lastSeenAt: null,
  },
  {
    id: 'member-globex-bob',
    tenantId: 'tenant-globex',
    userId: 'customer-bob-opaque',
    email: 'bob@example.com',
    displayName: 'Bob Example',
    tags: [],
    marketingConsents: [{ channel: 'email', granted: false, updatedAt: nowIso }],
    externalCustomerIds: [],
    createdAt: nowIso,
    lastSeenAt: null,
  },
]).onConflictDoNothing();

await db.insert(tenantDomains).values(
  tenantRows.map((tenant) => ({
    id: `domain-${tenant.slug}`,
    tenantId: tenant.id,
    domain: `${tenant.slug}.localhost`,
    kind: 'subdomain' as const,
    verified: true,
  })),
).onConflictDoNothing();

const todoRows = [
  {
    id: 'todo-walking-skeleton',
    tenantId: 'tenant-acme',
    title: 'Wdrożyć walking skeleton na produkcję',
  },
  {
    id: 'todo-tenant-isolation',
    tenantId: 'tenant-acme',
    title: 'Sprawdzić izolację danych między tenantami',
  },
  {
    id: 'todo-globex-architecture',
    tenantId: 'tenant-globex',
    title: 'Globex: przygotować prezentację architektury',
  },
];

// Todos list by ascending `createdAt`, so one shared timestamp would leave the
// documented order down to Postgres; a second apart makes the listing stable.
await db.insert(todos).values(
  todoRows.map((todo, index) => ({
    ...todo,
    createdBy: demoUser.id,
    createdAt: new Date(seededAt + index * 1000).toISOString(),
  })),
).onConflictDoNothing();

console.log('Seed applied:');
console.log(`  user     ${DEMO_EMAIL} / demo1234`);
console.log('  tenants  http://acme.localhost:47100  http://globex.localhost:47100');
process.exit(0);
