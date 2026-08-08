import { and, count, eq, sql } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Identity } from '#core/domain/index.js';
import {
  addCard,
  bindMemberOnSignIn,
  ensureMember,
  exportMember,
  listCards,
  listMembers,
  moveCard,
  removeMember,
  updateMember,
  type Ctx,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { createCardRepository } from './cards-repository.js';
import { createMemberRepository } from './members-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
  createTodoRepository,
} from './repositories.js';
import { createStaffRepository, createUserDirectory } from './staff-repository.js';
import { cards, members, tenantAdmins, tenantDomains, tenants, todos, user } from './schema.js';
import * as schema from './schema.js';

const ITEST_DB = 'agentproofarch_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

const itestUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();

const tenantA = { id: 'itest-tenant-a', slug: 'alpha', name: 'Alpha Inc', createdAt: '2026-01-01T00:00:00.000Z' };
const tenantB = { id: 'itest-tenant-b', slug: 'beta', name: 'Beta LLC', createdAt: '2026-01-01T00:00:00.000Z' };

const staffA = 'itest-staff-a';
const staffB = 'itest-staff-b';
const adminB = 'itest-admin-b';
const custA = 'itest-cust-a';
const custB = 'itest-cust-b';

const todoA1 = {
  id: 'itest-todo-a1',
  tenantId: tenantA.id,
  title: 'Alpha first',
  createdBy: staffA,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const todoA2 = {
  id: 'itest-todo-a2',
  tenantId: tenantA.id,
  title: 'Alpha second',
  createdBy: staffA,
  createdAt: '2026-01-02T00:00:00.000Z',
};
const todoB1 = {
  id: 'itest-todo-b1',
  tenantId: tenantB.id,
  title: 'Beta only',
  createdBy: staffB,
  createdAt: '2026-01-01T12:00:00.000Z',
};

const cardA1 = { id: 'itest-card-a1', tenantId: tenantA.id, title: 'A todo 1', board: 'personal' as const, column: 'todo', position: 0, visited: ['todo'], createdAt: '2026-01-01T00:00:00.000Z' };
const cardA2 = { id: 'itest-card-a2', tenantId: tenantA.id, title: 'A todo 2', board: 'personal' as const, column: 'todo', position: 1, visited: ['todo'], createdAt: '2026-01-02T00:00:00.000Z' };
const cardA3 = { id: 'itest-card-a3', tenantId: tenantA.id, title: 'A doing 1', board: 'personal' as const, column: 'doing', position: 0, visited: ['doing'], createdAt: '2026-01-03T00:00:00.000Z' };
const cardB1 = { id: 'itest-card-b1', tenantId: tenantB.id, title: 'B todo 1', board: 'personal' as const, column: 'todo', position: 0, visited: ['todo'], createdAt: '2026-01-01T00:00:00.000Z' };

let appPool: pg.Pool;
let db: Db;

const todoRepo = () => createTodoRepository(db);
const cardRepo = () => createCardRepository(db);
const domainRepo = () => createTenantDomainRepository(db);
const tenantRepo = () => createTenantRepository(db);
const accessReader = () => createTenantAccessReader(db);

const createIsolatedDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  } finally {
    await admin.end();
  }
};

const dropIsolatedDatabase = async (): Promise<void> => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
};

const runMigrations = async (): Promise<void> => {
  const migrationPool = new pg.Pool({ connectionString: itestUrl });
  try {
    await migrateNodePg(drizzleNodePg(migrationPool), { migrationsFolder: 'drizzle' });
  } finally {
    await migrationPool.end();
  }
};

const grantable = { id: 'itest-grantable', name: 'Grantable User', email: 'grantable@example.com' };

const seed = async (): Promise<void> => {
  await tenantRepo().createTenantWithOwner({
    tenant: tenantA,
    ownerGrant: { id: 'itest-grant-a', userId: staffA },
  });
  await tenantRepo().createTenantWithOwner({
    tenant: tenantB,
    ownerGrant: { id: 'itest-grant-b', userId: staffB },
  });

  // Global accounts (the auth `user` table) the staff roster join and the FR-8
  // directory lookup read. `grantable` holds no grant — the account that a grant
  // test promotes and revokes.
  await db.insert(user).values([
    { id: staffA, name: 'Staff A', email: 'staff-a@example.com' },
    { id: staffB, name: 'Staff B', email: 'staff-b@example.com' },
    { id: adminB, name: 'Admin B', email: 'admin-b@example.com' },
    grantable,
  ]);
  // An 'admin' grant on B — proves the non-owner role round-trips and stays scoped.
  await db.insert(tenantAdmins).values({
    id: 'itest-grant-b-admin',
    tenantId: tenantB.id,
    userId: adminB,
    role: 'admin',
  });

  await db.insert(members).values([
    {
      id: 'itest-member-a',
      tenantId: tenantA.id,
      userId: custA,
      email: 'cust-a@example.com',
      displayName: 'Customer A',
      createdAt: tenantA.createdAt,
    },
    {
      id: 'itest-member-b',
      tenantId: tenantB.id,
      userId: custB,
      email: 'cust-b@example.com',
      displayName: null,
      createdAt: tenantB.createdAt,
    },
  ]);

  await db.insert(tenantDomains).values([
    { id: 'itest-domain-a', tenantId: tenantA.id, domain: 'alpha.localhost', kind: 'subdomain', verified: true },
    { id: 'itest-domain-b', tenantId: tenantB.id, domain: 'beta.localhost', kind: 'subdomain', verified: true },
    {
      id: 'itest-domain-unverified',
      tenantId: tenantA.id,
      domain: 'unverified.localhost',
      kind: 'custom',
      verified: false,
    },
  ]);

  await todoRepo().create(todoA1);
  await todoRepo().create(todoA2);
  await todoRepo().create(todoB1);

  await cardRepo().create(cardA1);
  await cardRepo().create(cardA2);
  await cardRepo().create(cardA3);
  await cardRepo().create(cardB1);
};

beforeAll(async () => {
  await createIsolatedDatabase();
  await runMigrations();
  appPool = new pg.Pool({ connectionString: itestUrl });
  // afterAll's FORCE drop can race the pool's graceful socket teardown: a
  // client terminated server-side (57P01) emits 'error' with no listener and
  // crashes the whole run despite every test passing (CI 2026-07-21).
  appPool.on('error', () => {});
  db = drizzleNodePg(appPool, { schema });
  await seed();
}, 60_000);

afterAll(async () => {
  await appPool.end();
  await dropIsolatedDatabase();
});

describe('HealthPort', () => {
  it('pings a reachable database', async () => {
    expect(await createHealthPort(db).pingDatabase()).toBe(true);
  });

  it('reports false when the database is unreachable', async () => {
    const brokenPool = new pg.Pool({
      connectionString: 'postgresql://nobody:nobody@localhost:47542/agentproofarch_does_not_exist',
    });
    brokenPool.on('error', () => {});
    try {
      const health = createHealthPort(drizzleNodePg(brokenPool, { schema }));
      expect(await health.pingDatabase()).toBe(false);
    } finally {
      await brokenPool.end();
    }
  });
});

describe('TenantRepository', () => {
  it('createTenantWithOwner returns the created tenant and is read back by id and slug', async () => {
    const fresh = {
      id: 'itest-tenant-c',
      slug: 'gamma',
      name: 'Gamma GmbH',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const created = await tenantRepo().createTenantWithOwner({
      tenant: fresh,
      ownerGrant: { id: 'itest-grant-c', userId: 'itest-staff-c' },
    });
    expect(created).toEqual({ id: fresh.id, slug: fresh.slug, name: fresh.name });

    expect(await tenantRepo().findById(fresh.id)).toMatchObject({
      id: fresh.id,
      slug: fresh.slug,
      name: fresh.name,
    });
    expect(await tenantRepo().findBySlug(fresh.slug)).toMatchObject({ id: fresh.id });
  });

  it('findById and findBySlug return null for unknown tenants', async () => {
    expect(await tenantRepo().findById('itest-tenant-missing')).toBeNull();
    expect(await tenantRepo().findBySlug('missing-slug')).toBeNull();
  });

  it('createTenantWithOwner writes the founding owner grant in the same operation', async () => {
    const fresh = {
      id: 'itest-tenant-d',
      slug: 'delta',
      name: 'Delta Co',
      createdAt: '2026-02-02T00:00:00.000Z',
    };
    const userD = 'itest-staff-d';
    await tenantRepo().createTenantWithOwner({
      tenant: fresh,
      ownerGrant: { id: 'itest-grant-d', userId: userD },
    });
    expect(await accessReader().findStaffGrant(userD, { tenantId: fresh.id })).toEqual({
      tenant: { id: fresh.id, slug: fresh.slug, name: fresh.name },
      staffRole: 'owner',
    });
  });
});

describe('TodoRepository', () => {
  it('lists a tenant todos ordered by createdAt', async () => {
    const rows = await todoRepo().listByTenant(tenantA.id);
    expect(rows).toEqual([todoA1, todoA2]);
  });

  it('create inserts a todo visible only within its tenant', async () => {
    const extra = {
      id: 'itest-todo-a3',
      tenantId: tenantA.id,
      title: 'Alpha third',
      createdBy: staffA,
      createdAt: '2026-01-03T00:00:00.000Z',
    };
    await todoRepo().create(extra);
    const aIds = (await todoRepo().listByTenant(tenantA.id)).map((t) => t.id);
    expect(aIds).toContain(extra.id);
    const bIds = (await todoRepo().listByTenant(tenantB.id)).map((t) => t.id);
    expect(bIds).not.toContain(extra.id);
  });
});

describe('CardRepository', () => {
  it('lists a tenant cards ordered by column then position', async () => {
    const rows = await cardRepo().listByTenant(tenantA.id, 'personal');
    expect(rows.map((c) => c.id)).toEqual([cardA3.id, cardA1.id, cardA2.id]);
  });

  it('create inserts a card visible only within its tenant', async () => {
    const extra = { id: 'itest-card-a4', tenantId: tenantA.id, title: 'A doing 2', board: 'personal' as const, column: 'doing', position: 1, visited: ['doing'], createdAt: '2026-01-04T00:00:00.000Z' };
    await cardRepo().create(extra);
    const aIds = (await cardRepo().listByTenant(tenantA.id, 'personal')).map((c) => c.id);
    expect(aIds).toContain(extra.id);
    const bIds = (await cardRepo().listByTenant(tenantB.id, 'personal')).map((c) => c.id);
    expect(bIds).not.toContain(extra.id);
  });

  it('updatePositions rewrites column + position for the tenant rows', async () => {
    // Move cardA2 to the front of doing, renumber both columns contiguously.
    await cardRepo().updatePositions(tenantA.id, 'personal', [
      { id: cardA2.id, column: 'doing', position: 0 },
      { id: cardA3.id, column: 'doing', position: 1 },
      { id: cardA1.id, column: 'todo', position: 0 },
    ]);
    const byId = new Map((await cardRepo().listByTenant(tenantA.id, 'personal')).map((c) => [c.id, c]));
    expect(byId.get(cardA2.id)).toMatchObject({ column: 'doing', position: 0 });
    expect(byId.get(cardA3.id)).toMatchObject({ column: 'doing', position: 1 });
    expect(byId.get(cardA1.id)).toMatchObject({ column: 'todo', position: 0 });
  });

  it('updatePositions is tenant-scoped: another tenant cannot renumber these cards', async () => {
    const before = (await cardRepo().listByTenant(tenantB.id, 'personal')).find((c) => c.id === cardB1.id);
    // tenantA attempts to move tenantB's card — the id/tenant guard makes it a no-op.
    await cardRepo().updatePositions(tenantA.id, 'personal', [{ id: cardB1.id, column: 'done', position: 9 }]);
    const after = (await cardRepo().listByTenant(tenantB.id, 'personal')).find((c) => c.id === cardB1.id);
    expect(after).toEqual(before);
  });
});

describe('TenantDomainRepository', () => {
  it('findByDomain returns only verified domains', async () => {
    expect(await domainRepo().findByDomain('alpha.localhost')).toMatchObject({
      tenantId: tenantA.id,
      verified: true,
    });
    expect(await domainRepo().findByDomain('unverified.localhost')).toBeNull();
    expect(await domainRepo().findByDomain('nope.localhost')).toBeNull();
  });

  it('listVerifiedDomains excludes unverified domains', async () => {
    const domains = await domainRepo().listVerifiedDomains();
    expect(domains.every((d) => d.verified)).toBe(true);
    const domainNames = domains.map((d) => d.domain);
    expect(domainNames).toEqual(expect.arrayContaining(['alpha.localhost', 'beta.localhost']));
    expect(domainNames).not.toContain('unverified.localhost');
  });
});

describe('TenantAccessReader', () => {
  it('listTenantsForStaff returns memberships scoped to the staff user', async () => {
    const memberships = await accessReader().listTenantsForStaff(staffA);
    expect(memberships).toEqual([
      { tenant: { id: tenantA.id, slug: tenantA.slug, name: tenantA.name }, staffRole: 'owner' },
    ]);
  });

  it('findStaffGrant resolves by tenant id and by slug', async () => {
    expect(await accessReader().findStaffGrant(staffA, { tenantId: tenantA.id })).toMatchObject({
      staffRole: 'owner',
    });
    expect(await accessReader().findStaffGrant(staffA, { tenantSlug: tenantA.slug })).toMatchObject({
      tenant: { id: tenantA.id },
    });
  });

  it('findStaffGrant reads a non-owner (admin) role', async () => {
    expect(await accessReader().findStaffGrant(adminB, { tenantId: tenantB.id })).toEqual({
      tenant: { id: tenantB.id, slug: tenantB.slug, name: tenantB.name },
      staffRole: 'admin',
    });
  });

  it('findMember returns the member row for the tenant', async () => {
    expect(await accessReader().findMember(custA, tenantA.id)).toMatchObject({
      id: 'itest-member-a',
      tenantId: tenantA.id,
      userId: custA,
    });
  });
});

describe('tenant isolation invariant', () => {
  it('listByTenant never returns another tenant rows', async () => {
    const aTodos = await todoRepo().listByTenant(tenantA.id);
    expect(aTodos.every((t) => t.tenantId === tenantA.id)).toBe(true);
    expect(aTodos.map((t) => t.id)).not.toContain(todoB1.id);

    const bTodos = await todoRepo().listByTenant(tenantB.id);
    expect(bTodos.every((t) => t.tenantId === tenantB.id)).toBe(true);
    expect(bTodos.map((t) => t.id)).toEqual([todoB1.id]);
  });

  it('cards never leak across tenants', async () => {
    const aCards = await cardRepo().listByTenant(tenantA.id, 'personal');
    expect(aCards.every((c) => c.tenantId === tenantA.id)).toBe(true);
    expect(aCards.map((c) => c.id)).not.toContain(cardB1.id);

    const bCards = await cardRepo().listByTenant(tenantB.id, 'personal');
    expect(bCards.every((c) => c.tenantId === tenantB.id)).toBe(true);
    expect(bCards.map((c) => c.id)).toContain(cardB1.id);
  });

  it('findMember is scoped to the tenant and cannot cross tenants', async () => {
    expect(await accessReader().findMember(custA, tenantB.id)).toBeNull();
    expect(await accessReader().findMember(custB, tenantA.id)).toBeNull();
  });

  it('listTenantsForStaff never leaks another staff grants', async () => {
    const aMemberships = await accessReader().listTenantsForStaff(staffA);
    expect(aMemberships.map((m) => m.tenant.id)).not.toContain(tenantB.id);
    const bMemberships = await accessReader().listTenantsForStaff(staffB);
    expect(bMemberships.map((m) => m.tenant.id)).not.toContain(tenantA.id);
  });

  it('findStaffGrant refuses grants outside the staff and tenant scope', async () => {
    expect(await accessReader().findStaffGrant(staffA, { tenantId: tenantB.id })).toBeNull();
    expect(await accessReader().findStaffGrant(staffA, { tenantSlug: tenantB.slug })).toBeNull();
    expect(await accessReader().findStaffGrant(staffB, { tenantId: tenantA.id })).toBeNull();
  });
});

describe('team board rules against Postgres', () => {
  const identityA: Identity = {
    userId: staffA,
    email: 'staff-a@example.com',
    name: 'Staff A',
    tenantId: tenantA.id,
    tenantSlug: tenantA.slug,
    tenantName: tenantA.name,
    staffRole: 'owner',
    memberId: null,
  };
  const ctx: Ctx = { identity: identityA, tenantCreationMode: 'open' };
  const teamDeps = () => ({
    cards: cardRepo(),
    ids: { nextId: () => `itest-team-${crypto.randomUUID()}` },
    clock: { nowIso: () => '2026-03-01T00:00:00.000Z' },
  });

  it('cross-board isolation: the personal list never shows team cards', async () => {
    const teamCard = {
      id: 'itest-team-iso',
      tenantId: tenantA.id,
      title: 'Team iso',
      board: 'team' as const,
      column: 'todo',
      position: 0,
      visited: ['todo'],
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    await cardRepo().create(teamCard);

    const personal = await cardRepo().listByTenant(tenantA.id, 'personal');
    expect(personal.map((c) => c.id)).not.toContain(teamCard.id);
    expect(personal.every((c) => c.board === 'personal')).toBe(true);

    const team = await cardRepo().listByTenant(tenantA.id, 'team');
    expect(team.map((c) => c.id)).toContain(teamCard.id);
    expect(team.every((c) => c.board === 'team')).toBe(true);
  });

  it('drives the guarded path and round-trips visited history through jsonb', async () => {
    const created = await addCard(ctx, { title: 'Guarded task', board: 'team', column: 'todo' }, teamDeps());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.id;
    expect(created.value.visited).toEqual(['todo']);

    // review before in-dev is rejected with its rule, and persists nothing.
    const early = await moveCard(ctx, { cardId: id, board: 'team', toColumn: 'review', toIndex: 0 }, teamDeps());
    expect(early).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'review-requires-in-dev' } },
    });
    const afterReject = (await cardRepo().listByTenant(tenantA.id, 'team')).find((c) => c.id === id);
    expect(afterReject).toMatchObject({ column: 'todo', visited: ['todo'] });

    // The legal path advances the card and grows visited, round-tripped through PG.
    for (const toColumn of ['in-dev', 'review', 'done']) {
      const step = await moveCard(ctx, { cardId: id, board: 'team', toColumn, toIndex: 0 }, teamDeps());
      expect(step.ok).toBe(true);
    }
    const settled = (await cardRepo().listByTenant(tenantA.id, 'team')).find((c) => c.id === id);
    expect(settled).toMatchObject({ column: 'done' });
    expect(settled?.visited).toEqual(['todo', 'in-dev', 'review', 'done']);
  });

  it('enforces the WIP limit against real rows', async () => {
    // in-dev limit is 3: seed three occupants, a fourth move is rejected.
    for (let i = 0; i < 3; i += 1) {
      await cardRepo().create({
        id: `itest-team-wip-${i}`,
        tenantId: tenantA.id,
        title: `WIP ${i}`,
        board: 'team' as const,
        column: 'in-dev',
        position: i,
        visited: ['todo', 'in-dev'],
        createdAt: '2026-03-01T00:00:00.000Z',
      });
    }
    const created = await addCard(ctx, { title: 'Fourth', board: 'team', column: 'todo' }, teamDeps());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const blocked = await moveCard(
      ctx,
      { cardId: created.value.id, board: 'team', toColumn: 'in-dev', toIndex: 0 },
      teamDeps(),
    );
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { rule: 'wip-limit' } },
    });
  });

  it('listCards use-case is board-scoped end to end', async () => {
    const personal = await listCards(ctx, { board: 'personal' }, teamDeps());
    expect(personal.ok && personal.value.every((c) => c.board === 'personal')).toBe(true);
    const team = await listCards(ctx, { board: 'team' }, teamDeps());
    expect(team.ok && team.value.every((c) => c.board === 'team')).toBe(true);
  });
});

// The members aggregate through the real repository + use-cases. Runs BEFORE the
// offboarding cascade (which deletes tenant A) and only ever touches members it
// creates itself, so the seeded rows the cascade suite counts stay intact.
describe('MemberRepository + member use-cases', () => {
  const memberRepo = () => createMemberRepository(db);
  const staffCtx = (tenantId: string): Ctx => ({
    identity: {
      userId: `staff-of-${tenantId}`,
      email: 'staff@example.com',
      name: 'Staff',
      tenantId,
      tenantSlug: 'x',
      tenantName: 'X',
      staffRole: 'owner',
      memberId: null,
    },
    tenantCreationMode: 'open',
  });
  const memberDeps = () => ({
    members: memberRepo(),
    ids: { nextId: () => `itest-member-${Math.random().toString(36).slice(2)}` },
    clock: { nowIso: () => '2026-03-01T00:00:00.000Z' },
  });

  it('cross-tenant isolation: a tenant sees only its own members (F5)', async () => {
    const deps = memberDeps();
    const inB = await ensureMember(
      staffCtx(tenantB.id),
      { email: 'isolation@example.com', tags: ['beta-only'] },
      deps,
    );
    expect(inB.ok).toBe(true);
    const bMemberId = inB.ok ? inB.value.member.id : '';

    const listedA = await listMembers(staffCtx(tenantA.id), deps);
    expect(listedA.ok && listedA.value.some((m) => m.id === bMemberId)).toBe(false);

    // A staff member of A cannot read (or export) B's member by id — tenant-scoped.
    expect(await memberRepo().findByTenantAndId(tenantA.id, bMemberId)).toBeNull();
    const exportAcrossTenant = await exportMember(staffCtx(tenantA.id), { id: bMemberId }, deps);
    expect(exportAcrossTenant).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('bindMemberOnSignIn claims a provisioned member against Postgres (US-026)', async () => {
    const deps = memberDeps();
    const provisioned = await ensureMember(staffCtx(tenantA.id), { email: 'bind@example.com' }, deps);
    expect(provisioned.ok && provisioned.value.member.userId).toBeNull();
    const memberId = provisioned.ok ? provisioned.value.member.id : '';

    const bound = await bindMemberOnSignIn(
      { tenantId: tenantA.id, userId: 'itest-bound-user', email: 'bind@example.com' },
      { members: memberRepo(), clock: { nowIso: () => '2026-03-02T00:00:00.000Z' } },
    );
    expect(bound?.id).toBe(memberId);
    expect(bound?.userId).toBe('itest-bound-user');

    // The claim persisted: the row now carries the account id and lastSeenAt.
    const persisted = await memberRepo().findByTenantAndId(tenantA.id, memberId);
    expect(persisted?.userId).toBe('itest-bound-user');
    expect(persisted?.lastSeenAt).toBe('2026-03-02T00:00:00.000Z');

    // Idempotent: a second, different account does NOT steal the bound member.
    const second = await bindMemberOnSignIn(
      { tenantId: tenantA.id, userId: 'itest-other-user', email: 'bind@example.com' },
      { members: memberRepo(), clock: { nowIso: () => '2026-03-03T00:00:00.000Z' } },
    );
    expect(second).toBeNull();
    expect((await memberRepo().findByTenantAndId(tenantA.id, memberId))?.userId).toBe('itest-bound-user');
  });

  it('ensureMember is idempotent by (tenant, email)', async () => {
    const deps = memberDeps();
    const first = await ensureMember(staffCtx(tenantA.id), { email: 'idem@example.com' }, deps);
    const second = await ensureMember(staffCtx(tenantA.id), { email: 'idem@example.com' }, deps);
    expect(first.ok && first.value.created).toBe(true);
    expect(second.ok && second.value.created).toBe(false);
    expect(first.ok && second.ok && first.value.member.id === second.value.member.id).toBe(true);
  });

  it('same email in two tenants keeps independent profiles; removing one leaves the other + account (US-025)', async () => {
    const deps = memberDeps();
    const sharedEmail = 'dual@example.com';
    const inA = await ensureMember(staffCtx(tenantA.id), { email: sharedEmail, tags: ['alpha-vip'] }, deps);
    const inB = await ensureMember(staffCtx(tenantB.id), { email: sharedEmail, tags: ['beta-basic'] }, deps);
    expect(inA.ok && inB.ok).toBe(true);
    const aId = inA.ok ? inA.value.member.id : '';
    const bId = inB.ok ? inB.value.member.id : '';
    expect(aId).not.toBe(bId);

    // Independent profiles: an update in A must not touch B's tags.
    await updateMember(staffCtx(tenantA.id), { id: aId, tags: ['alpha-vip', 'renewed'] }, deps);
    const bBefore = await memberRepo().findByEmail(tenantB.id, sharedEmail);
    expect(bBefore?.tags).toEqual(['beta-basic']);

    // Removing A's member deletes exactly A's row and reports the cascade count.
    const removed = await removeMember(staffCtx(tenantA.id), { id: aId }, deps);
    expect(removed).toMatchObject({ ok: true, value: { memberId: aId, deleted: { members: 1 } } });
    expect(await memberRepo().findByTenantAndId(tenantA.id, aId)).toBeNull();

    // B's member (its own row and the shared global account it points at) survives.
    const bAfter = await memberRepo().findByEmail(tenantB.id, sharedEmail);
    expect(bAfter?.id).toBe(bId);
    expect(bAfter?.tags).toEqual(['beta-basic']);
  });
});

// The staff roster + directory through the real repository (FR-8). Every mutation
// targets `grantable` (a user with no seeded grant), so the seeded tenant-A grants
// the offboarding cascade counts stay intact.
describe('StaffRepository + UserDirectory', () => {
  const staffRepo = () => createStaffRepository(db);
  const userDir = () => createUserDirectory(db);

  it('listByTenant joins the account for email/name and is tenant-scoped', async () => {
    const roster = await staffRepo().listByTenant(tenantB.id);
    expect(roster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: staffB, email: 'staff-b@example.com', role: 'owner' }),
        expect.objectContaining({ userId: adminB, email: 'admin-b@example.com', role: 'admin' }),
      ]),
    );
    // A's staff never leaks into B's roster.
    expect(roster.map((row) => row.userId)).not.toContain(staffA);
  });

  it('findGrant reads the tenant grant graph, tenant-scoped', async () => {
    expect(await staffRepo().findGrant(tenantA.id, staffA)).toMatchObject({ userId: staffA, role: 'owner' });
    // adminB is B's admin — invisible from A, and not an owner of B.
    expect(await staffRepo().findGrant(tenantA.id, adminB)).toBeNull();
    expect(await staffRepo().findGrant(tenantB.id, adminB)).toMatchObject({ role: 'admin' });
  });

  it('findByEmail resolves an account case-insensitively and returns null for unknowns', async () => {
    expect(await userDir().findByEmail('grantable@example.com')).toEqual({
      userId: grantable.id,
      email: grantable.email,
      name: grantable.name,
    });
    expect(await userDir().findByEmail('GRANTABLE@example.com')).toMatchObject({ userId: grantable.id });
    expect(await userDir().findByEmail('nobody@example.com')).toBeNull();
  });

  it('grant then revoke round-trips a grant, tenant-scoped (cross-tenant revoke is a no-op)', async () => {
    await staffRepo().grant({ id: 'itest-grant-grantable-b', tenantId: tenantB.id, userId: grantable.id, role: 'admin' });
    expect(await staffRepo().findGrant(tenantB.id, grantable.id)).toMatchObject({ role: 'admin' });
    // Cross-tenant isolation: the grant lives only in B.
    expect(await staffRepo().findGrant(tenantA.id, grantable.id)).toBeNull();
    expect((await staffRepo().listByTenant(tenantA.id)).map((row) => row.userId)).not.toContain(grantable.id);

    // A tenant-A revoke cannot remove a tenant-B grant (an admin is always
    // removable — the last-owner guard only protects owners).
    expect(await staffRepo().revokeLastOwnerSafe(tenantA.id, grantable.id)).toBe(0);
    expect(await staffRepo().revokeLastOwnerSafe(tenantB.id, grantable.id)).toBe(1);
    expect(await staffRepo().findGrant(tenantB.id, grantable.id)).toBeNull();
  });

  // C3 last-owner race (§Data conventions invariant matrix): two concurrent
  // revokes of the two distinct owners must not both succeed. The FOR UPDATE
  // owner-count guard serializes them, so exactly one is removed and the tenant
  // keeps an owner. Proven against real Postgres — the guarantee is the
  // statement's, not the app's.
  it('never lets two concurrent revokes drop a tenant below one owner', async () => {
    const raceTenant = {
      id: 'itest-tenant-race',
      slug: 'race',
      name: 'Race Co',
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    await tenantRepo().createTenantWithOwner({
      tenant: raceTenant,
      ownerGrant: { id: 'itest-grant-race-1', userId: 'race-owner-1' },
    });
    await staffRepo().grant({
      id: 'itest-grant-race-2',
      tenantId: raceTenant.id,
      userId: 'race-owner-2',
      role: 'owner',
    });

    const [first, second] = await Promise.all([
      staffRepo().revokeLastOwnerSafe(raceTenant.id, 'race-owner-1'),
      staffRepo().revokeLastOwnerSafe(raceTenant.id, 'race-owner-2'),
    ]);

    // Exactly one revoke wins; the tenant keeps an owner (counted straight off
    // tenant_admins — the roster join to `user` would drop these account-less
    // seed grants).
    expect(first + second).toBe(1);
    const owners = await db
      .select({ c: count() })
      .from(tenantAdmins)
      .where(and(eq(tenantAdmins.tenantId, raceTenant.id), eq(tenantAdmins.role, 'owner')));
    expect(owners[0]?.c).toBe(1);
  });
});

// C3 invariant placement (§Data conventions matrix): closed-set columns are
// guarded at the DB by CHECK constraints, and app-only invariants (the member
// marketing-consent channel union, held in jsonb) are guarded by the adapter's
// zod boundary. These probes write garbage the app layer would never emit —
// straight past the use-cases via raw SQL — and assert the guard fires.
describe('C3 invariant enforcement', () => {
  const accessReaderC3 = () => createTenantAccessReader(db);

  // The driver wraps the pg error, so the constraint name lives on `.cause`.
  const expectCheckViolation = async (statement: ReturnType<typeof sql>, constraint: string): Promise<void> => {
    try {
      await db.execute(statement);
    } catch (error) {
      const text = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : String(error);
      expect(text).toMatch(new RegExp(`${constraint}|violates check constraint`, 'i'));
      return;
    }
    throw new Error(`expected the insert to be rejected by ${constraint}`);
  };

  it('DB rejects a tenant_admins.role outside the closed set', async () => {
    await expectCheckViolation(
      sql`INSERT INTO tenant_admins (id, tenant_id, user_id, role) VALUES ('itest-bad-role', ${tenantB.id}, 'ghost', 'superuser')`,
      'tenant_admins_role_check',
    );
  });

  it('DB rejects a tenant_domains.kind outside the closed set', async () => {
    await expectCheckViolation(
      sql`INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified) VALUES ('itest-bad-kind', ${tenantB.id}, 'bad.example.com', 'wildcard', false)`,
      'tenant_domains_kind_check',
    );
  });

  it('DB rejects a cards.board outside the closed set', async () => {
    await expectCheckViolation(
      sql`INSERT INTO cards (id, tenant_id, title, board, "column", position, created_at) VALUES ('itest-bad-board', ${tenantB.id}, 'x', 'archive', 'todo', 0, '2026-01-01T00:00:00.000Z')`,
      'cards_board_check',
    );
  });

  it('DB rejects a cards.column that is not legal for its board', async () => {
    await expectCheckViolation(
      sql`INSERT INTO cards (id, tenant_id, title, board, "column", position, created_at) VALUES ('itest-bad-col', ${tenantB.id}, 'x', 'personal', 'in-dev', 0, '2026-01-01T00:00:00.000Z')`,
      'cards_column_check',
    );
  });

  it('the adapter zod boundary rejects a corrupted member marketing-consent channel', async () => {
    // marketing_consents is jsonb (no closed-set CHECK possible); the app-only
    // invariant lives at the read boundary. Plant a garbage channel via raw SQL.
    await db.execute(
      sql`INSERT INTO members (id, tenant_id, user_id, email, tags, marketing_consents, external_customer_ids, created_at)
          VALUES ('itest-corrupt-member', ${tenantB.id}, 'corrupt-user', 'corrupt@example.com', '[]'::jsonb,
                  '[{"channel":"carrier-pigeon","granted":true,"updatedAt":"2026-01-01T00:00:00.000Z"}]'::jsonb,
                  '[]'::jsonb, '2026-01-01T00:00:00.000Z')`,
    );
    await expect(accessReaderC3().findMember('corrupt-user', tenantB.id)).rejects.toThrow();
  });

  it('the adapter zod boundary rejects a corrupted card row (negative position)', async () => {
    await db.execute(
      sql`INSERT INTO cards (id, tenant_id, title, board, "column", position, visited, created_at)
          VALUES ('itest-corrupt-card', ${tenantB.id}, 'corrupt', 'personal', 'todo', -1, '[]'::jsonb, '2026-01-01T00:00:00.000Z')`,
    );
    await expect(cardRepo().listByTenant(tenantB.id, 'personal')).rejects.toThrow();
  });
});

// Runs LAST: it deletes tenant A, so every earlier suite must have observed the
// seeded A rows before this destructive cascade removes them.
describe('tenant offboarding cascade', () => {
  // Every tenant-owned aggregate, counted directly against the tables (cards
  // spans both boards, so it is not board-scoped here).
  const tenantRowCounts = async (tenantId: string) => {
    const [todoRows, cardRows, memberRows, adminRows, domainRows, tenantRows] = await Promise.all([
      db.select().from(todos).where(eq(todos.tenantId, tenantId)),
      db.select().from(cards).where(eq(cards.tenantId, tenantId)),
      db.select().from(members).where(eq(members.tenantId, tenantId)),
      db.select().from(tenantAdmins).where(eq(tenantAdmins.tenantId, tenantId)),
      db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId)),
      db.select().from(tenants).where(eq(tenants.id, tenantId)),
    ]);
    return {
      todos: todoRows.length,
      cards: cardRows.length,
      members: memberRows.length,
      admins: adminRows.length,
      domains: domainRows.length,
      tenant: tenantRows.length,
    };
  };

  it('deleteTenant erases every A aggregate and leaves every B row untouched', async () => {
    const beforeA = await tenantRowCounts(tenantA.id);
    // A owns at least one row in each aggregate, so the cascade has something to prove.
    expect(beforeA.tenant).toBe(1);
    expect(beforeA.todos).toBeGreaterThan(0);
    expect(beforeA.cards).toBeGreaterThan(0);
    expect(beforeA.members).toBeGreaterThan(0);
    expect(beforeA.admins).toBeGreaterThan(0);
    expect(beforeA.domains).toBeGreaterThan(0);

    const beforeB = await tenantRowCounts(tenantB.id);

    await tenantRepo().deleteTenant(tenantA.id);

    expect(await tenantRowCounts(tenantA.id)).toEqual({
      todos: 0,
      cards: 0,
      members: 0,
      admins: 0,
      domains: 0,
      tenant: 0,
    });
    expect(await tenantRowCounts(tenantB.id)).toEqual(beforeB);
  });
});
