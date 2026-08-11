import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import {
  createApiTokenSecrets,
  createPadSessionSecrets,
} from '#adapters/auth/api-token-secrets.js';
import { createDb } from '#adapters/db/client.js';
import { createApiTokenRepository } from '#adapters/db/api-tokens-repository.js';
import { createDocumentRepository } from '#adapters/db/documents-repository.js';
import { createPadSessionRepository } from '#adapters/db/pad-sessions-repository.js';
import { createUserPreferenceRepository } from '#adapters/db/user-preferences-repository.js';
import { createTenantSettingsRepository } from '#adapters/db/tenant-settings-repository.js';
import { createTenantAccountRepository } from '#adapters/db/tenant-accounts-repository.js';
import { createSignatureRecordRepository } from '#adapters/db/signature-records-repository.js';
import { createSourceUpdateRequestRepository } from '#adapters/db/source-update-requests-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
} from '#adapters/db/repositories.js';
import { tenantAdmins, tenants, user } from '#adapters/db/schema.js';
import * as schema from '#adapters/db/schema.js';
import { closePoolAndDropIntegrationDatabase } from '#adapters/db/test-support/integration-database.js';
import {
  API_ROUTES,
  TENANT_HEADER,
  apiTokenCreateOutputSchema,
  documentCreateOutputSchema,
  documentFileOutputSchema,
  looseEnvelopeSchema,
} from '#core/contract/index.js';
import { ok, type AppError, type Result } from '#core/domain/index.js';
import type { StorageMetadata, StoragePort, UploadTarget } from '#core/server/index.js';

import { buildApp } from './app.js';

const ITEST_DB = 'agentproofarch_api_tokens_itest';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://agentproofarch:agentproofarch@localhost:47542/agentproofarch';

const itestUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${ITEST_DB}`;
  return url.toString();
})();

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

let pool: pg.Pool;
let app: ReturnType<typeof buildApp>;

const expectData = async <T>(
  response: Response,
  schemaForData: { parse: (value: unknown) => T },
): Promise<T> => {
  const envelope = looseEnvelopeSchema.parse(await response.json());
  if (!envelope.ok) throw new Error(envelope.error.message);
  return schemaForData.parse(envelope.data);
};

const memoryStorage = (): StoragePort => {
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    put: async (key, bytes, contentType) => {
      blobs.set(key, { bytes, contentType });
      return ok(undefined);
    },
    get: async (key) => ok(blobs.get(key)?.bytes ?? null),
    head: async (key): Promise<Result<StorageMetadata | null, AppError>> => {
      const blob = blobs.get(key);
      return ok(blob ? { contentType: blob.contentType, sizeBytes: blob.bytes.byteLength } : null);
    },
    delete: async (key) => {
      blobs.delete(key);
      return ok(undefined);
    },
    createUploadUrl: async (): Promise<Result<UploadTarget | null, AppError>> => ok(null),
  };
};

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${ITEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${ITEST_DB}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: itestUrl });
  const db = drizzleNodePg(pool, { schema });
  await migrateNodePg(db, { migrationsFolder: 'drizzle' });
  await db
    .insert(tenants)
    .values({ id: 'tenant-default', slug: 'default', name: 'Archive', createdAt: '2026-08-02T00:00:00.000Z' });
  await db.insert(user).values({
    id: 'user-owner',
    email: 'owner@example.com',
    name: 'Owner',
  });
  await db.insert(tenantAdmins).values({
    id: 'grant-owner',
    tenantId: 'tenant-default',
    userId: 'user-owner',
    role: 'owner',
  });

  const auth = createAuth(
    createDb('node-postgres', itestUrl),
    {
      secret: 'test-secret-value-that-is-at-least-32-chars',
      baseUrl: 'http://localhost',
      baseDomain: 'localhost',
      rateLimitEnabled: false,
      trustedOrigins: [],
      secureCookies: false,
      email: { sendMail: async () => {} },
    },
  );

  app = buildApp({
    auth,
    authPort: {
      getAuthenticatedUser: async () => ({
        userId: 'user-owner',
        email: 'owner@example.com',
        name: 'Owner',
      }),
    },
    apiTokens: createApiTokenRepository(db),
    apiTokenSecrets: createApiTokenSecrets(),
    invitationEmail: null,
    invitations: {
      createOrReplace: async () => { throw new Error('not implemented'); },
      listByTenant: async () => [],
      findByTokenHash: async () => null,
      hasAccount: async () => false,
      accept: async () => false,
      revoke: async () => false,
      expire: async () => {},
      expirePastDue: async () => {},
    },
    invitationSecrets: {
      generate: () => 'invite-secret',
      hash: (value) => value,
      matchesHash: (value, tokenHash) => value === tokenHash,
    },
    invitationAuth: { createAccount: async () => ({ userId: 'invited-user' }) },
    invitationRateLimit: { consume: async () => true },
    invitationRateLimitEnabled: false,
    emailConfigured: false,
    documents: createDocumentRepository(db),
    padSessions: createPadSessionRepository(db),
    padSessionSecrets: createPadSessionSecrets(),
    userPreferences: createUserPreferenceRepository(db),
    tenantSettings: createTenantSettingsRepository(db),
    tenantAccounts: createTenantAccountRepository(db),
    signatureRecords: createSignatureRecordRepository(db),
    sourceUpdateRequests: createSourceUpdateRequestRepository(db),
    savedSearches: {
      listByTenant: async () => [],
      create: async (input) => ({ ...input, createdAt: '2026-08-02T00:00:00.000Z' }),
      delete: async () => false,
    },
    storage: memoryStorage(),
    tenantDomains: createTenantDomainRepository(db),
    email: { sendMail: async () => {} },
    googleEnabled: false,
    passwordResetEnabled: true,
    tenants: createTenantRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids: { nextId: () => ids.shift() ?? '55555555-5555-4555-8555-555555555555' },
    baseDomain: 'localhost',
    baseUrl: 'http://localhost',
    now: () => new Date('2026-08-10T10:00:00.000Z'),
    commitSha: 'test-sha',
  });
}, 60_000);

afterAll(async () => {
  await closePoolAndDropIntegrationDatabase({
    pool,
    adminDatabaseUrl: baseDatabaseUrl,
    databaseName: ITEST_DB,
  });
});

describe('API token HTTP integration', () => {
  it('creates a draft through bearer auth, then forbids token writes after approval', async () => {
    const createdToken = await app.request(API_ROUTES.apiTokensCreate.path, {
      method: API_ROUTES.apiTokensCreate.method,
      headers: { [TENANT_HEADER]: 'default', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Importer', scopes: ['write:draft'] }),
    });
    expect(createdToken.status).toBe(200);
    const tokenData = await expectData(createdToken, apiTokenCreateOutputSchema);

    const createdDocument = await app.request(API_ROUTES.documentsCreate.path, {
      method: API_ROUTES.documentsCreate.method,
      headers: {
        [TENANT_HEADER]: 'default',
        authorization: `Bearer ${tokenData.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Imported draft',
        docType: 'inny',
        documentDate: '2026-08-02',
        tags: [],
        draft: true,
      }),
    });
    expect(createdDocument.status).toBe(200);
    const documentData = await expectData(createdDocument, documentCreateOutputSchema);
    expect(documentData.document.draft).toBe(true);

    const upload = await app.request(
      API_ROUTES.documentFileServerUpload.path.replace(':documentId', documentData.document.id) +
        '?fileName=import.pdf&role=source',
      {
        method: API_ROUTES.documentFileServerUpload.method,
        headers: {
          [TENANT_HEADER]: 'default',
          authorization: `Bearer ${tokenData.value}`,
          'content-type': 'application/pdf',
        },
        body: new Uint8Array([1, 2, 3]),
      },
    );
    expect(upload.status).toBe(200);
    await expectData(upload, documentFileOutputSchema);

    const approved = await app.request(
      API_ROUTES.documentApprove.path.replace(':documentId', documentData.document.id),
      {
        method: API_ROUTES.documentApprove.method,
        headers: { [TENANT_HEADER]: 'default' },
      },
    );
    expect(approved.status).toBe(200);

    const denied = await app.request(
      API_ROUTES.documentUpdate.path.replace(':documentId', documentData.document.id),
      {
        method: API_ROUTES.documentUpdate.method,
        headers: {
          [TENANT_HEADER]: 'default',
          authorization: `Bearer ${tokenData.value}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Should fail',
          docType: 'inny',
          documentDate: '2026-08-02',
          tags: [],
        }),
      },
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
