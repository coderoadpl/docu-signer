import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  PadCurrentDocument,
  PadQueuedSubmission,
  PadSignatureRequest,
  PadSubmittedStrokes,
  SavedSearchFilter,
  SignatureRecordPayload,
  UserPreferenceValue,
} from '#core/domain/index.js';
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

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['owner', 'admin'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'accepted', 'revoked', 'expired'],
    }).notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('invitations_tenant_status_idx').on(table.tenantId, table.status),
    uniqueIndex('invitations_token_hash_uidx').on(table.tokenHash),
    uniqueIndex('invitations_tenant_email_pending_uidx')
      .on(table.tenantId, table.email)
      .where(sql`${table.status} = 'pending'`),
    check('invitations_role_check', sql`${table.role} IN ('owner', 'admin')`),
    check(
      'invitations_status_check',
      sql`${table.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
  ],
);

export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    storeSignatureRecords: boolean('store_signature_records').notNull().default(true),
    pdfSealEnabled: boolean('pdf_seal_enabled').notNull().default(false),
    signatureBoxEnabled: boolean('signature_box_enabled').notNull().default(false),
    dateMode: text('date_mode', { enum: ['declared', 'actual'] }).notNull().default('declared'),
  },
  (table) => [
    check('tenant_settings_date_mode_check', sql`${table.dateMode} IN ('declared', 'actual')`),
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
    signatureNotRequired: boolean('signature_not_required').notNull().default(false),
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

export const padSessions = pgTable(
  'pad_sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    secretHash: text('secret_hash').notNull(),
    mode: text('mode', { enum: ['private', 'shared'] }).notNull().default('private'),
    status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    currentRequest: jsonb('current_request').$type<PadSignatureRequest>(),
    currentDocument: jsonb('current_document').$type<PadCurrentDocument>(),
    submittedStrokes: jsonb('submitted_strokes').$type<PadSubmittedStrokes>(),
  },
  (table) => [
    index('pad_sessions_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('pad_sessions_tenant_expires_idx').on(table.tenantId, table.expiresAt),
    uniqueIndex('pad_sessions_tenant_creator_active_uidx')
      .on(table.tenantId, table.createdBy)
      .where(sql`${table.status} = 'active'`),
    check('pad_sessions_status_check', sql`${table.status} IN ('active', 'closed')`),
    check('pad_sessions_mode_check', sql`${table.mode} IN ('private', 'shared')`),
  ],
);

export const padSessionParticipants = pgTable(
  'pad_session_participants',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => padSessions.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('pad_session_participants_session_account_uidx').on(
      table.sessionId,
      table.accountId,
    ),
    index('pad_session_participants_tenant_session_idx').on(
      table.tenantId,
      table.sessionId,
    ),
  ],
);

export const padSessionSubmissions = pgTable(
  'pad_session_submissions',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => padSessions.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id'),
    document: jsonb('document').$type<PadCurrentDocument>().notNull(),
    strokes: jsonb('strokes').$type<PadQueuedSubmission['strokes']>().notNull(),
    inkColor: text('ink_color', { enum: ['black', 'navy'] }).notNull(),
    sourceSize: jsonb('source_size').$type<PadQueuedSubmission['sourceSize']>().notNull(),
    contributorAccountId: text('contributor_account_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contributorLabel: text('contributor_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('pad_session_submissions_tenant_session_created_idx').on(
      table.tenantId,
      table.sessionId,
      table.createdAt,
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

export const signatureRecords = pgTable(
  'signature_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => documentFiles.id, { onDelete: 'cascade' }),
    signedBy: text('signed_by').notNull(),
    payload: jsonb('payload').$type<SignatureRecordPayload>(),
    replayedFromId: uuid('replayed_from_id'),
    sealSubject: text('seal_subject'),
    sealDeclaredAt: timestamp('seal_declared_at', { withTimezone: true }),
    sealAppliedAt: timestamp('seal_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('signature_records_tenant_document_created_idx').on(
      table.tenantId,
      table.documentId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('signature_records_file_uidx')
      .on(table.fileId)
      .where(sql`${table.replayedFromId} IS NULL`),
    check(
      'signature_records_payload_check',
      sql`${table.payload} IS NULL OR (jsonb_typeof(${table.payload}) = 'array' AND jsonb_array_length(${table.payload}) > 0)`,
    ),
    check(
      'signature_records_seal_metadata_check',
      sql`(${table.sealSubject} IS NULL AND ${table.sealDeclaredAt} IS NULL AND ${table.sealAppliedAt} IS NULL) OR (${table.sealSubject} IS NOT NULL AND ${table.sealDeclaredAt} IS NOT NULL AND ${table.sealAppliedAt} IS NOT NULL)`,
    ),
  ],
);

export const sourceUpdateRequests = pgTable(
  'source_update_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    newSourceFileId: uuid('new_source_file_id').notNull(),
    newSignedFileId: uuid('new_signed_file_id'),
    mode: text('mode', { enum: ['delete-signed', 'transfer'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'completed', 'rejected', 'cancelled'],
    }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    priorSourceFileIds: uuid('prior_source_file_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    priorSignedFileIds: uuid('prior_signed_file_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  },
  (table) => [
    index('source_update_requests_tenant_status_idx').on(table.tenantId, table.status),
    uniqueIndex('source_update_requests_document_pending_uidx')
      .on(table.documentId)
      .where(sql`${table.status} = 'pending'`),
    check(
      'source_update_requests_mode_check',
      sql`${table.mode} IN ('delete-signed', 'transfer')`,
    ),
    check(
      'source_update_requests_status_check',
      sql`${table.status} IN ('pending', 'completed', 'rejected', 'cancelled')`,
    ),
  ],
);

export const sourceUpdateApprovals = pgTable(
  'source_update_approvals',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => sourceUpdateRequests.id, { onDelete: 'cascade' }),
    approverId: text('approver_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    decision: text('decision', {
      enum: ['pending', 'accepted', 'rejected'],
    }).notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    index('source_update_approvals_approver_decision_idx').on(
      table.approverId,
      table.decision,
    ),
    uniqueIndex('source_update_approvals_request_approver_uidx').on(
      table.requestId,
      table.approverId,
    ),
    check(
      'source_update_approvals_decision_check',
      sql`${table.decision} IN ('pending', 'accepted', 'rejected')`,
    ),
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

export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<UserPreferenceValue>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    check('user_preferences_key_length_check', sql`length(${table.key}) BETWEEN 1 AND 120`),
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
