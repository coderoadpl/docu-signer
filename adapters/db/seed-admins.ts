import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';

import type { Db } from './client.js';
import { account, tenantAdmins, tenantDomains, tenants, user } from './schema.js';

export interface SeedAdmin {
  readonly slot: '1';
  readonly email: string;
  readonly password: string;
  readonly role: 'owner' | 'admin';
}

export interface SeedAdminResult {
  readonly email: string;
  readonly role: SeedAdmin['role'];
  readonly status: 'created' | 'exists';
}

interface SeedTenantDomainResult {
  readonly domain: string;
  readonly status: 'created' | 'exists';
}

interface DeploySeedResult {
  readonly admins: readonly SeedAdminResult[];
  readonly domain: SeedTenantDomainResult | null;
}

interface SeedAdminEnvironment {
  readonly SEED_ADMIN1_EMAIL?: string | undefined;
  readonly SEED_ADMIN1_PASSWORD?: string | undefined;
}

export const configuredSeedAdmins = (env: SeedAdminEnvironment): readonly SeedAdmin[] => {
  const admins: SeedAdmin[] = [];
  if (env.SEED_ADMIN1_EMAIL && env.SEED_ADMIN1_PASSWORD) {
    admins.push({
      slot: '1',
      email: env.SEED_ADMIN1_EMAIL,
      password: env.SEED_ADMIN1_PASSWORD,
      role: 'owner',
    });
  }
  return admins;
};

const ensureAdminAccount = async (
  db: Db,
  admin: SeedAdmin,
): Promise<{ userId: string; status: SeedAdminResult['status'] }> => {
  const found = await db.select().from(user).where(eq(user.email, admin.email)).limit(1);
  const existingUser = found[0];
  const userId = existingUser?.id ?? randomUUID();
  if (!existingUser) {
    await db.insert(user).values({
      id: userId,
      name: `Archive Admin ${admin.slot}`,
      email: admin.email,
      emailVerified: true,
    });
  }

  const credentials = await db
    .select()
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
    .limit(1);
  const credential = credentials[0];
  const passwordHash = await hashPassword(admin.password);
  if (credential) {
    await db.update(account).set({ password: passwordHash }).where(eq(account.id, credential.id));
  } else {
    await db.insert(account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });
  }

  return {
    userId,
    status: existingUser && credential ? 'exists' : 'created',
  };
};

export const ensureSeedAdmins = async (
  db: Db,
  admins: readonly SeedAdmin[],
): Promise<readonly SeedAdminResult[]> => {
  if (admins.length === 0) return [];

  await db
    .insert(tenants)
    .values({
      id: 'tenant-default',
      slug: 'default',
      name: 'Amazing Company',
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();

  const results: SeedAdminResult[] = [];
  for (const admin of admins) {
    const ensured = await ensureAdminAccount(db, admin);
    const grants = await db
      .select()
      .from(tenantAdmins)
      .where(
        and(
          eq(tenantAdmins.tenantId, 'tenant-default'),
          eq(tenantAdmins.userId, ensured.userId),
        ),
      )
      .limit(1);
    const grant = grants[0];
    if (grant) {
      await db.update(tenantAdmins).set({ role: admin.role }).where(eq(tenantAdmins.id, grant.id));
    } else {
      await db
        .insert(tenantAdmins)
        .values({
          id: `admin-default-${admin.slot}`,
          tenantId: 'tenant-default',
          userId: ensured.userId,
          role: admin.role,
        })
        .onConflictDoUpdate({
          target: tenantAdmins.id,
          set: { userId: ensured.userId, role: admin.role },
        });
    }
    results.push({ email: admin.email, role: admin.role, status: ensured.status });
  }
  return results;
};

const ensureDefaultTenantDomain = async (
  db: Db,
  domain: string,
): Promise<SeedTenantDomainResult> => {
  const inserted = await db
    .insert(tenantDomains)
    .values({
      id: randomUUID(),
      tenantId: 'tenant-default',
      domain,
      kind: 'custom',
      verified: true,
    })
    .onConflictDoNothing({ target: tenantDomains.domain })
    .returning({ domain: tenantDomains.domain });
  if (inserted.length > 0) return { domain, status: 'created' };

  await db
    .update(tenantDomains)
    .set({ tenantId: 'tenant-default', kind: 'custom', verified: true })
    .where(eq(tenantDomains.domain, domain));
  return { domain, status: 'exists' };
};

export const ensureDeploySeed = async (
  db: Db,
  admins: readonly SeedAdmin[],
  appBaseDomain?: string,
): Promise<DeploySeedResult> => {
  if (admins.length === 0) return { admins: [], domain: null };

  const existingUsers = await db.select({ id: user.id }).from(user).limit(1);
  if (existingUsers.length > 0) return { admins: [], domain: null };

  const adminResults = await ensureSeedAdmins(db, admins);
  const domain = appBaseDomain
    ? await ensureDefaultTenantDomain(db, appBaseDomain)
    : null;
  return { admins: adminResults, domain };
};
