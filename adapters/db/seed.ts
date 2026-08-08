import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';

import { createDb } from './client.js';
import { account, tenantAdmins, tenants, user } from './schema.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

const admin1Email = process.env['SEED_ADMIN1_EMAIL'] ?? 'admin1@dev.local';
const admin2Email = process.env['SEED_ADMIN2_EMAIL'] ?? 'admin2@dev.local';
const admin1Password = process.env['SEED_ADMIN1_PASSWORD'] ?? `dev-${randomUUID()}`;
const admin2Password = process.env['SEED_ADMIN2_PASSWORD'] ?? `dev-${randomUUID()}`;

if (admin1Email === admin2Email) throw new Error('Seed admin emails must be different');

const db = createDb('node-postgres', connectionString);

const ensureAdmin = async (name: string, email: string, password: string) => {
  const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
  const userId = existing[0]?.id ?? randomUUID();
  if (existing.length === 0) {
    await db.insert(user).values({ id: userId, name, email, emailVerified: true });
  }

  const passwordHash = await hashPassword(password);
  const existingAccount = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1);
  if (existingAccount[0]) {
    await db.update(account).set({ password: passwordHash }).where(eq(account.id, existingAccount[0].id));
  } else {
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });
  }
  return userId;
};

const admin1Id = await ensureAdmin('Admin 1', admin1Email, admin1Password);
const admin2Id = await ensureAdmin('Admin 2', admin2Email, admin2Password);
const nowIso = new Date().toISOString();

await db.insert(tenants).values({
  id: 'tenant-default',
  slug: 'default',
  name: 'Default',
  createdAt: nowIso,
}).onConflictDoNothing();

await db.insert(tenantAdmins).values([
  {
    id: 'admin-default-1',
    tenantId: 'tenant-default',
    userId: admin1Id,
    role: 'owner',
  },
  {
    id: 'admin-default-2',
    tenantId: 'tenant-default',
    userId: admin2Id,
    role: 'admin',
  },
]).onConflictDoNothing();

console.log('Seed applied:');
console.log(`  admin 1  ${admin1Email} / ${admin1Password}`);
console.log(`  admin 2  ${admin2Email} / ${admin2Password}`);
console.log('  tenant   default');
process.exit(0);
