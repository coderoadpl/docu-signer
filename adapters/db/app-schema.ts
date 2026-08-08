import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { BOARD_IDS } from '#core/domain/index.js';

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('tenants_slug_uidx').on(table.slug)],
);

export const tenantAdmins = pgTable(
  'tenant_admins',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
  },
  (table) => [
    index('tenant_admins_tenantId_idx').on(table.tenantId),
    index('tenant_admins_userId_idx').on(table.userId),
    uniqueIndex('tenant_admins_tenant_user_uidx').on(table.tenantId, table.userId),
    // C3 invariant: role is a closed set enforced at the DB (not only the TS enum).
    check('tenant_admins_role_check', sql`${table.role} IN ('owner', 'admin')`),
  ],
);

// The end-customer aggregate. `members` predates the §Data conventions ruling
// and is on its GRANDFATHER list (text id + text ISO `created_at`), so — unlike
// a brand-new table — it stays text/text and is NOT migrated to uuid/timestamptz
// (converting a grandfathered table is a separate expand→contract package "the
// day a query needs index-backed time semantics"). The columns added for the
// full aggregate join that same grandfathered convention on purpose: a single
// table must not mix a text `created_at` with a timestamptz `last_seen_at`. New
// SIBLING aggregates keyed by `member_id` (progress, orders) are the ones that
// adopt uuid/timestamptz. `user_id` is nullable: `ensureMember` provisions a
// member row before any auth account exists (the passwordless binding is US-026).
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    email: text('email').notNull(),
    displayName: text('display_name'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    marketingConsents: jsonb('marketing_consents')
      .$type<{ channel: string; granted: boolean; updatedAt: string }[]>()
      .notNull()
      .default([]),
    externalCustomerIds: jsonb('external_customer_ids').$type<string[]>().notNull().default([]),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (table) => [
    index('members_tenantId_idx').on(table.tenantId),
    index('members_userId_idx').on(table.userId),
    uniqueIndex('members_tenant_user_uidx').on(table.tenantId, table.userId),
    // The idempotency key for `ensureMember` (find-or-create by tenant+email).
    uniqueIndex('members_tenant_email_uidx').on(table.tenantId, table.email),
  ],
);

export const todos = pgTable(
  'todos',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdBy: text('created_by').notNull(),
    // ISO 8601 string; the domain speaks ISO strings, not driver-specific Dates.
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('todos_tenantId_idx').on(table.tenantId)],
);

export const cards = pgTable(
  'cards',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Which board this card lives on. Defaults to 'personal' so every card that
    // predates the team board — and every payload that omits `board` — stays on
    // the personal board with no backfill.
    board: text('board', { enum: BOARD_IDS }).notNull().default('personal'),
    // Board-agnostic: the legal column set is data of a board, validated at the
    // use-case boundary, so the substrate stores a plain string.
    column: text('column').notNull(),
    // Contiguous 0-based index within a (tenant, board, column); rewritten on move.
    position: integer('position').notNull(),
    // Ordered columns the card has entered — read by the team board's
    // review-requires-in-dev guard. jsonb string array; defaults to empty.
    visited: jsonb('visited').$type<string[]>().notNull().default([]),
    // ISO 8601 string; the domain speaks ISO strings, not driver-specific Dates.
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('cards_tenant_board_column_idx').on(
      table.tenantId,
      table.board,
      table.column,
      table.position,
    ),
    // C3 invariant: board is a closed set, and a card's column must be legal for
    // its board — enforced at the DB, defence-in-depth behind the use-case guard.
    check('cards_board_check', sql`${table.board} IN ('personal', 'team')`),
    check(
      'cards_column_check',
      sql`(${table.board} = 'personal' AND ${table.column} IN ('todo', 'doing', 'done')) OR (${table.board} = 'team' AND ${table.column} IN ('todo', 'in-dev', 'review', 'done'))`,
    ),
  ],
);

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    kind: text('kind', { enum: ['subdomain', 'custom'] }).notNull(),
    verified: boolean('verified').notNull().default(false),
  },
  (table) => [
    uniqueIndex('tenant_domains_domain_uidx').on(table.domain),
    // C3 invariant: kind is a closed set enforced at the DB (not only the TS enum).
    check('tenant_domains_kind_check', sql`${table.kind} IN ('subdomain', 'custom')`),
  ],
);

// C4 backfill executor (§Backfills): one durable checkpoint row per registered
// backfill, so a cron-driven batch run resumes exactly where the last invocation
// stopped. NEW table → §Data conventions shape: uuid PK + timestamptz. `name` is
// the registry key (unique); `cursor` is the opaque resume token the backfill
// advances; `done` latches when the backfill has processed every row.
export const backfillCheckpoints = pgTable('backfill_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  cursor: text('cursor'),
  processed: integer('processed').notNull().default(0),
  done: boolean('done').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
