/**
 * Demo seed: one user who belongs to two tenants, each with its own todos.
 *   email:    demo@agentproofarch.dev
 *   password: demo1234
 * Tenants: acme.localhost and globex.localhost (subdomains of APP_BASE_DOMAIN).
 * Idempotent: running twice is a no-op.
 */
import { eq } from 'drizzle-orm';

import { createAuth } from '#adapters/auth/create-auth.js';

import { createDb } from './client.js';
import { members, tenantAdmins, tenantDomains, tenants, todos, user } from './schema.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

const db = createDb('node-postgres', connectionString);

const auth = createAuth(db, {
  secret: process.env['BETTER_AUTH_SECRET'] ?? 'dev-only-secret-do-not-use-in-prod',
  baseUrl: 'http://localhost:47100',
  baseDomain: 'localhost',
  trustedOrigins: () => ['http://localhost:47100'],
  secureCookies: false,
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

const nowIso = new Date().toISOString();

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
    createdAt: nowIso,
  },
  {
    id: 'member-globex-bob',
    tenantId: 'tenant-globex',
    userId: 'customer-bob-opaque',
    email: 'bob@example.com',
    displayName: 'Bob Example',
    createdAt: nowIso,
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

await db.insert(todos).values([
  {
    id: crypto.randomUUID(),
    tenantId: 'tenant-acme',
    title: 'Wdrożyć walking skeleton na produkcję',
    createdBy: demoUser.id,
    createdAt: nowIso,
  },
  {
    id: crypto.randomUUID(),
    tenantId: 'tenant-acme',
    title: 'Sprawdzić izolację danych między tenantami',
    createdBy: demoUser.id,
    createdAt: nowIso,
  },
  {
    id: crypto.randomUUID(),
    tenantId: 'tenant-globex',
    title: 'Globex: przygotować prezentację architektury',
    createdBy: demoUser.id,
    createdAt: nowIso,
  },
]).onConflictDoNothing();

console.log('Seed applied:');
console.log(`  user     ${DEMO_EMAIL} / demo1234`);
console.log('  tenants  http://acme.localhost:47100  http://globex.localhost:47100');
process.exit(0);
