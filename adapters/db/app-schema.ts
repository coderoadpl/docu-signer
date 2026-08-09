import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { SavedSearchFilter } from '#core/domain/index.js';
import { user } from './auth-schema.js';

const LEGACY_BOARD_IDS = ['personal', 'team'] as const;

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
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Which board this card lives on. Defaults to 'personal' so every card that
    // predates the team board — and every payload that omits `board` — stays on
    // the personal board with no backfill.
    board: text('board', { enum: LEGACY_BOARD_IDS }).notNull().default('personal'),
    // Board-agnostic: the legal column set is data of a board, validated at the
    // use-case boundary, so the substrate stores a plain string.
    column: text('column').notNull(),
    // Contiguous 0-based index within a (tenant, board, column); rewritten on move.
    position: integer('position').notNull(),
    // Ordered columns the card has entered — read by the team board's
    // review-requires-in-dev guard. jsonb string array; defaults to empty.
    visited: jsonb('visited').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
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

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    docType: text('doc_type', {
      enum: ['umowa-uod', 'uchwala', 'protokol', 'rachunek', 'inny'],
    }).notNull(),
    documentDate: date('document_date').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    person: text('person'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    draft: boolean('draft').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('documents_tenant_date_idx').on(table.tenantId, table.documentDate),
    check(
      'documents_doc_type_check',
      sql`${table.docType} IN ('umowa-uod', 'uchwala', 'protokol', 'rachunek', 'inny')`,
    ),
    check(
      'documents_period_order_check',
      sql`${table.periodStart} IS NULL OR ${table.periodEnd} IS NULL OR ${table.periodStart} <= ${table.periodEnd}`,
    ),
  ],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('api_tokens_user_created_idx').on(table.userId, table.createdAt),
    uniqueIndex('api_tokens_token_hash_uidx').on(table.tokenHash),
    check('api_tokens_name_length_check', sql`length(${table.name}) BETWEEN 1 AND 120`),
    check(
      'api_tokens_scopes_check',
      sql`${table.scopes} <@ '["read", "write", "write:draft"]'::jsonb AND jsonb_array_length(${table.scopes}) BETWEEN 1 AND 3`,
    ),
  ],
);

export const documentFiles = pgTable(
  'document_files',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['source', 'signed-scan', 'signed-digital', 'other'],
    }).notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('document_files_document_idx').on(table.documentId, table.createdAt),
    check(
      'document_files_role_check',
      sql`${table.role} IN ('source', 'signed-scan', 'signed-digital', 'other')`,
    ),
    check('document_files_size_check', sql`${table.sizeBytes} >= 0 AND ${table.sizeBytes} <= 26214400`),
  ],
);

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<SavedSearchFilter>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('saved_searches_tenant_created_idx').on(table.tenantId, table.createdAt),
    check('saved_searches_name_length_check', sql`length(${table.name}) BETWEEN 1 AND 120`),
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

export const backfillCheckpoints = pgTable('backfill_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  cursor: text('cursor'),
  processed: integer('processed').notNull().default(0),
  done: boolean('done').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
