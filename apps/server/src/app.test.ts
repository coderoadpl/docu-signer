import { describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import {
  API_PATHS,
  API_ROUTES,
  PAD_SECRET_HEADER,
  looseEnvelopeSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';
import {
  MAX_PAD_STROKES_BYTES,
  PAD_STROKES_TOO_LARGE_MESSAGE,
  ok,
  type Document,
  type DocumentListFilter,
  type PadSession,
} from '#core/domain/index.js';
import type { AuthenticatedUser } from '#core/server/index.js';

import { buildApp } from './app.js';
import type { AppDeps } from './composition.js';

const auth = createAuth(
  createDb('node-postgres', 'postgresql://user:pass@localhost:5432/agentproofarch_test'),
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

const baseDeps = (): AppDeps => ({
  auth,
  authPort: { getAuthenticatedUser: async () => null },
  apiTokens: {
    create: async () => {
      throw new Error('not implemented');
    },
    listByUser: async () => [],
    findActiveByHash: async () => null,
    markUsed: async () => {},
    revoke: async () => false,
  },
  apiTokenSecrets: {
    generate: () => 'pat_test',
    hash: (value) => value,
    matchesHash: (value, tokenHash) => value === tokenHash,
  },
  documents: {
    listByTenant: async () => [],
    listDeletedByTenant: async () => [],
    findById: async () => null,
    findDeletedById: async () => null,
    findAnyById: async () => null,
    listFiles: async () => [],
    listFilesIncludingDeleted: async () => [],
    listFilesForDocuments: async () => [],
    create: async () => {
      throw new Error('not implemented');
    },
    update: async () => null,
    approve: async () => null,
    delete: async () => false,
    restore: async () => null,
    purge: async () => false,
    createFile: async () => null,
    findFile: async () => null,
    moveFileToDocument: async () => null,
    deleteFile: async () => false,
  },
  padSessions: {
    create: async (input) => ({
      ...input,
      status: 'active',
      createdAt: '2026-08-02T00:00:00.000Z',
      lastPolledAt: null,
      currentRequest: null,
      submittedStrokes: null,
    }),
    findById: async () => null,
    findActiveByUser: async () => null,
    renew: async () => null,
    requestSignature: async () => null,
    submitStrokes: async () => null,
    consumeStrokes: async () => null,
    close: async () => false,
  },
  padSessionSecrets: {
    generate: () => 'pad_secret',
    hash: (value) => value,
    matchesHash: (value, tokenHash) => value === tokenHash,
  },
  savedSearches: {
    listByTenant: async () => [],
    create: async (input) => ({
      ...input,
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
    delete: async () => false,
  },
  userPreferences: {
    get: async () => null,
    set: async (userId, key, value) => ({
      userId,
      key,
      value,
      updatedAt: '2026-08-02T10:00:00.000Z',
    }),
  },
  tenantSettings: {
    get: async () => null,
    set: async (tenantId, storeSignatureRecords) => ({
      tenantId,
      storeSignatureRecords,
    }),
  },
  signatureRecords: {
    listByDocument: async () => [],
    create: async (input) => ({
      ...input,
      createdAt: '2026-08-07T10:00:00.000Z',
    }),
  },
  storage: {
    put: async () => ok(undefined),
    get: async () => ok(null),
    head: async () => ok(null),
    delete: async () => ok(undefined),
    createUploadUrl: async () => ok(null),
  },
  tenantDomains: {
    findByDomain: async () => null,
    listVerifiedDomains: async () => [],
  },
  email: { sendMail: async () => {} },
  googleEnabled: false,
  passwordResetEnabled: true,
  tenants: {
    findById: async () => null,
    findBySlug: async () => null,
  },
  tenantAccess: { findStaffGrant: async () => null },
  health: { pingDatabase: async () => true },
  ids: { nextId: () => '11111111-1111-4111-8111-111111111111' },
  baseDomain: 'localhost',
  commitSha: 'test-sha',
});

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
};
const tenant = { id: 'tenant-default', slug: 'default', name: 'Archive' };

const authorizedDeps = (): AppDeps => {
  const deps = baseDeps();
  deps.authPort = { getAuthenticatedUser: async () => user };
  deps.tenants = {
    findById: async (id) => (id === tenant.id ? tenant : null),
    findBySlug: async (slug) => (slug === tenant.slug ? tenant : null),
  };
  deps.tenantAccess = {
    findStaffGrant: async (_userId, tenantId) =>
      tenantId === tenant.id ? { staffRole: 'owner' } : null,
  };
  return deps;
};

describe('buildApp', () => {
  it('serves health and readiness with deploy attestation', async () => {
    const app = buildApp(baseDeps());
    const health = await app.request(API_PATHS.health);
    const ready = await app.request(API_PATHS.healthReady);
    const live = await app.request(API_PATHS.healthLive);

    expect(health.status).toBe(200);
    expect(ready.status).toBe(200);
    expect(live.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      data: { database: 'up', sha: 'test-sha' },
    });
  });

  it('returns unavailable when readiness cannot reach the database', async () => {
    const deps = baseDeps();
    deps.health = { pingDatabase: async () => false };
    const response = await buildApp(deps).request(API_PATHS.healthReady);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
  });

  it('rejects an anonymous document request with the unauthorized taxonomy', async () => {
    const response = await buildApp(baseDeps()).request(API_PATHS.documents);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });

  it('lists only documents from the resolved tenant', async () => {
    const deps = authorizedDeps();
    let seenTenant = '';
    let seenFilter: DocumentListFilter = {};
    const row: Document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: tenant.id,
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    };
    deps.documents.listByTenant = async (tenantId, filter) => {
      seenTenant = tenantId;
      seenFilter = filter;
      return [row];
    };
    const response = await buildApp(deps).request(
      `${API_PATHS.documents}?signatureStatus=needs-signature`,
      {
        headers: { [TENANT_HEADER]: tenant.slug },
      },
    );

    expect(response.status).toBe(200);
    expect(seenTenant).toBe(tenant.id);
    expect(seenFilter).toEqual({ signatureStatus: 'needs-signature' });
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { documents: [{ title: 'Umowa' }] },
    });
  });

  it('creates a document after validating its payload', async () => {
    const deps = authorizedDeps();
    deps.documents.create = async (input) => ({
      ...input,
      draft: input.draft ?? false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    });
    const response = await buildApp(deps).request(API_ROUTES.documentsCreate.path, {
      method: API_ROUTES.documentsCreate.method,
      headers: { [TENANT_HEADER]: tenant.slug, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Umowa',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
        tags: [],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { document: { title: 'Umowa', tenantId: tenant.id } },
    });
  });

  it('lists trash, restores and purges documents through the contract routes', async () => {
    const deps = authorizedDeps();
    const row: Document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: tenant.id,
      title: 'Usunięta umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      deletedAt: '2026-08-02T00:00:00.000Z',
    };
    deps.documents.listDeletedByTenant = async () => [row];
    deps.documents.findById = async () => null;
    deps.documents.findDeletedById = async () => row;
    deps.documents.restore = async () => ({ ...row, deletedAt: null });
    deps.documents.findAnyById = async () => row;
    deps.documents.purge = async () => true;

    const app = buildApp(deps);
    const list = await app.request(API_ROUTES.documentsTrash.path, {
      headers: { [TENANT_HEADER]: tenant.slug },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      ok: true,
      data: { documents: [{ title: 'Usunięta umowa', deletedAt: row.deletedAt }] },
    });

    const restore = await app.request(
      '/api/documents/11111111-1111-4111-8111-111111111111/restore',
      {
        method: API_ROUTES.documentRestore.method,
        headers: { [TENANT_HEADER]: tenant.slug },
      },
    );
    expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({
      ok: true,
      data: { document: { title: 'Usunięta umowa', deletedAt: null } },
    });

    const purge = await app.request(
      '/api/documents/11111111-1111-4111-8111-111111111111/purge',
      {
        method: API_ROUTES.documentPurge.method,
        headers: { [TENANT_HEADER]: tenant.slug },
      },
    );
    expect(purge.status).toBe(200);
    expect(await purge.json()).toMatchObject({ ok: true, data: { deleted: true } });

    const anonymous = await buildApp(baseDeps()).request(API_ROUTES.documentsTrash.path);
    expect(anonymous.status).toBe(401);
  });

  it('serves tenant settings and write-once signature records', async () => {
    const deps = authorizedDeps();
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const recordId = '33333333-3333-4333-8333-333333333333';
    const document: Document = {
      id: documentId,
      tenantId: tenant.id,
      title: 'Umowa',
      docType: 'umowa-uod',
      documentDate: '2026-08-07',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: false,
      createdAt: '2026-08-07T10:00:00.000Z',
      updatedAt: '2026-08-07T10:00:00.000Z',
      deletedAt: null,
    };
    const file = {
      id: fileId,
      documentId,
      role: 'signed-digital' as const,
      fileName: 'umowa-podpisana.pdf',
      contentType: 'application/pdf',
      sizeBytes: 3,
      storageKey: 'documents/tenant-default/document/file',
      createdAt: '2026-08-07T10:00:00.000Z',
    };
    const payload = [
      {
        strokes: [{ points: [{ x: 0.2, y: 0.3, pressure: 0.8 }] }],
        pageIndex: 0,
        placement: { offsetX: 0.1, offsetY: 0.2, scale: 1 },
        inkColor: 'black' as const,
        inkSize: 2,
      },
    ];
    let storedSettings = true;
    const records: Array<{
      id: string;
      tenantId: string;
      documentId: string;
      fileId: string;
      signedBy: string;
      payload: typeof payload;
      createdAt: string;
    }> = [];
    deps.ids = { nextId: () => recordId };
    deps.documents.findById = async () => document;
    deps.documents.findFile = async () => file;
    deps.tenantSettings = {
      get: async (tenantId) => ({
        tenantId,
        storeSignatureRecords: storedSettings,
      }),
      set: async (tenantId, storeSignatureRecords) => {
        storedSettings = storeSignatureRecords;
        return { tenantId, storeSignatureRecords };
      },
    };
    deps.signatureRecords = {
      listByDocument: async () => records,
      create: async (input) => {
        const record = {
          ...input,
          payload,
          createdAt: '2026-08-07T10:00:00.000Z',
        };
        records.push(record);
        return record;
      },
    };
    const app = buildApp(deps);
    const headers = { [TENANT_HEADER]: tenant.slug };

    const settings = await app.request(API_ROUTES.tenantSettings.path, { headers });
    expect(await settings.json()).toMatchObject({
      ok: true,
      data: { settings: { storeSignatureRecords: true } },
    });
    const updated = await app.request(API_ROUTES.tenantSettingsUpdate.path, {
      method: API_ROUTES.tenantSettingsUpdate.method,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ storeSignatureRecords: false }),
    });
    expect(await updated.json()).toMatchObject({
      ok: true,
      data: { settings: { storeSignatureRecords: false } },
    });
    const created = await app.request(
      API_ROUTES.signatureRecordsCreate.path.replace(':documentId', documentId),
      {
        method: API_ROUTES.signatureRecordsCreate.method,
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ fileId, payload }),
      },
    );
    expect(await created.json()).toMatchObject({
      ok: true,
      data: { signatureRecord: { id: recordId, fileId } },
    });
    const listed = await app.request(
      API_ROUTES.signatureRecords.path.replace(':documentId', documentId),
      { headers },
    );
    expect(await listed.json()).toMatchObject({
      ok: true,
      data: { items: [{ id: recordId }], nextCursor: null },
    });
  });

  it('drives pad session routes through the contract handlers', async () => {
    const deps = authorizedDeps();
    const requestId = '22222222-2222-4222-8222-222222222222';
    const padSession: PadSession = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: tenant.id,
      createdBy: user.userId,
      secretHash: 'hash:pad_secret',
      status: 'active' as const,
      createdAt: '2026-08-04T10:00:00.000Z',
      expiresAt: '2099-08-04T14:00:00.000Z',
      lastPolledAt: null,
      currentRequest: null,
      submittedStrokes: null,
    };
    let currentPadSession = padSession;
    deps.ids = { nextId: () => requestId };
    deps.padSessionSecrets = {
      generate: () => 'pad_secret',
      hash: (value) => `hash:${value}`,
      matchesHash: (value, tokenHash) => `hash:${value}` === tokenHash,
    };
    deps.padSessions = {
      create: async (input) => {
        currentPadSession = { ...padSession, ...input, id: requestId };
        return currentPadSession;
      },
      findById: async () => currentPadSession,
      findActiveByUser: async () => currentPadSession,
      renew: async (_tenantId, _sessionId, expiresAt, lastPolledAt) => {
        currentPadSession = { ...currentPadSession, expiresAt, lastPolledAt };
        return currentPadSession;
      },
      requestSignature: async (_tenantId, _sessionId, request) => {
        currentPadSession = {
          ...currentPadSession,
          currentRequest: request,
        };
        return currentPadSession;
      },
      submitStrokes: async (_tenantId, _sessionId, strokes) => {
        currentPadSession = {
          ...currentPadSession,
          submittedStrokes: strokes,
        };
        return currentPadSession;
      },
      consumeStrokes: async () => ({
        requestId,
        inkColor: 'black',
        sourceSize: { width: 834, height: 620 },
        strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
      }),
      close: async () => true,
    };
    const app = buildApp(deps);
    const tenantHeader = { [TENANT_HEADER]: tenant.slug };

    const created = await app.request(API_ROUTES.padSessionsCreate.path, {
      method: API_ROUTES.padSessionsCreate.method,
      headers: tenantHeader,
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toMatchObject({
      ok: true,
      data: { secret: 'pad_secret' },
    });

    const active = await app.request(API_ROUTES.padSessionActive.path, {
      headers: tenantHeader,
    });
    await expect(active.json()).resolves.toMatchObject({
      ok: true,
      data: { session: { createdBy: user.userId } },
    });

    const joined = await app.request(API_ROUTES.padSessionJoin.path, {
      method: API_ROUTES.padSessionJoin.method,
      headers: tenantHeader,
    });
    await expect(joined.json()).resolves.toMatchObject({
      ok: true,
      data: { session: { createdBy: user.userId } },
    });

    const state = await app.request(
      API_ROUTES.padSessionState.path.replace(':sessionId', padSession.id),
      { headers: { ...tenantHeader, [PAD_SECRET_HEADER]: 'pad_secret' } },
    );
    expect(state.status).toBe(200);

    const requested = await app.request(
      API_ROUTES.padSessionRequest.path.replace(':sessionId', padSession.id),
      {
        method: API_ROUTES.padSessionRequest.method,
        headers: tenantHeader,
        body: JSON.stringify({ documentTitle: 'Umowa' }),
      },
    );
    await expect(requested.json()).resolves.toMatchObject({
      ok: true,
      data: { request: { requestId, documentTitle: 'Umowa' } },
    });

    const submitted = await app.request(
      API_ROUTES.padSessionSubmit.path.replace(':sessionId', padSession.id),
      {
        method: API_ROUTES.padSessionSubmit.method,
        headers: {
          ...tenantHeader,
          'content-type': 'application/json',
          [PAD_SECRET_HEADER]: 'pad_secret',
        },
        body: JSON.stringify({
          requestId,
          inkColor: 'black',
          sourceSize: { width: 834, height: 620 },
          strokes: [{ points: [{ x: 0.1, y: 0.2, pressure: 0.5 }] }],
        }),
      },
    );
    await expect(submitted.json()).resolves.toMatchObject({
      ok: true,
      data: { submitted: true },
    });

    const oversized = await app.request(
      API_ROUTES.padSessionSubmit.path.replace(':sessionId', padSession.id),
      {
        method: API_ROUTES.padSessionSubmit.method,
        headers: {
          ...tenantHeader,
          'content-length': String(MAX_PAD_STROKES_BYTES + 1),
          'content-type': 'application/json',
          [PAD_SECRET_HEADER]: 'pad_secret',
        },
        body: 'x'.repeat(MAX_PAD_STROKES_BYTES + 1),
      },
    );
    expect(MAX_PAD_STROKES_BYTES).toBe(4 * 1024 * 1024);
    const oversizedBody: unknown = await oversized.json();
    expect({ status: oversized.status, body: oversizedBody }).toMatchObject({
      status: 400,
      body: {
        ok: false,
        error: { message: PAD_STROKES_TOO_LARGE_MESSAGE },
      },
    });

    const consumed = await app.request(
      API_ROUTES.padSessionConsume.path.replace(':sessionId', padSession.id),
      { method: API_ROUTES.padSessionConsume.method, headers: tenantHeader },
    );
    await expect(consumed.json()).resolves.toMatchObject({
      ok: true,
      data: { submittedStrokes: { requestId }, lastPolledAt: expect.any(String) },
    });

    const closed = await app.request(
      API_ROUTES.padSessionClose.path.replace(':sessionId', padSession.id),
      { method: API_ROUTES.padSessionClose.method, headers: tenantHeader },
    );
    await expect(closed.json()).resolves.toMatchObject({
      ok: true,
      data: { closed: true },
    });

    const disconnected = await app.request(
      API_ROUTES.padSessionDisconnect.path.replace(':sessionId', padSession.id),
      {
        method: API_ROUTES.padSessionDisconnect.method,
        headers: { ...tenantHeader, [PAD_SECRET_HEADER]: 'pad_secret' },
      },
    );
    await expect(disconnected.json()).resolves.toMatchObject({
      ok: true,
      data: { closed: true },
    });
  });

  it('serves document file content and export responses', async () => {
    const deps = authorizedDeps();
    const document: Document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: tenant.id,
      title: 'Eksport',
      docType: 'inny',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    };
    const file = {
      id: '22222222-2222-4222-8222-222222222222',
      documentId: document.id,
      role: 'source' as const,
      fileName: 'scan.png',
      contentType: 'image/png',
      sizeBytes: 3,
      storageKey: 'documents/tenant-default/export/source',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    deps.documents.findById = async () => document;
    deps.documents.findFile = async () => file;
    deps.documents.listFiles = async () => [file];
    deps.storage.get = async () => ok(new Uint8Array([1, 2, 3]));

    const app = buildApp(deps);
    const content = await app.request(
      '/api/documents/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222/content',
      { headers: { [TENANT_HEADER]: tenant.slug } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get('content-disposition')).toContain('inline');
    expect(new Uint8Array(await content.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const single = await app.request(
      '/api/documents/11111111-1111-4111-8111-111111111111/files/22222222-2222-4222-8222-222222222222/export',
      { headers: { [TENANT_HEADER]: tenant.slug } },
    );
    expect(single.status).toBe(200);
    expect(single.headers.get('content-disposition')).toContain('2026-08-01--eksport--source.png');

    const invalid = await app.request(API_ROUTES.documentsExport.path, {
      method: API_ROUTES.documentsExport.method,
      headers: { [TENANT_HEADER]: tenant.slug, 'content-type': 'application/json' },
      body: JSON.stringify({ documentIds: [] }),
    });
    expect(invalid.status).toBe(400);

    const archive = await app.request(API_ROUTES.documentsExport.path, {
      method: API_ROUTES.documentsExport.method,
      headers: { [TENANT_HEADER]: tenant.slug, 'content-type': 'application/json' },
      body: JSON.stringify({ documentIds: [document.id] }),
    });
    expect(archive.status).toBe(200);
    expect(archive.headers.get('content-type')).toBe('application/zip');
  });

  it('authenticates API tokens and rejects revoked or wrong-scope document requests', async () => {
    const deps = authorizedDeps();
    const row: Document = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: tenant.id,
      title: 'Draft',
      docType: 'umowa-uod',
      documentDate: '2026-08-01',
      periodStart: null,
      periodEnd: null,
      person: null,
      tags: [],
      draft: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    };
    deps.apiTokenSecrets = {
      generate: () => 'pat_unused',
      hash: (value) => `hash:${value}`,
      matchesHash: (value, tokenHash) => `hash:${value}` === tokenHash,
    };
    deps.apiTokens.findActiveByHash = async (tokenHash) =>
      tokenHash === 'hash:pat_write_draft'
        ? {
            token: {
              id: '22222222-2222-4222-8222-222222222222',
              userId: user.userId,
              name: 'Importer',
              tokenHash,
              scopes: ['write:draft'],
              createdAt: '2026-08-02T00:00:00.000Z',
              lastUsedAt: null,
              revokedAt: null,
            },
            user,
          }
        : null;
    deps.documents.create = async (input) => ({
      ...input,
      draft: input.draft ?? false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      deletedAt: null,
    });
    deps.documents.findById = async () => row;
    deps.documents.update = async () => ({ ...row, title: 'Updated' });

    const created = await buildApp(deps).request(API_ROUTES.documentsCreate.path, {
      method: API_ROUTES.documentsCreate.method,
      headers: {
        [TENANT_HEADER]: tenant.slug,
        authorization: 'Bearer pat_write_draft',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Draft',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
        tags: [],
        draft: true,
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ ok: true, data: { document: { draft: true } } });

    const deleteDenied = await buildApp(deps).request(API_ROUTES.documentDelete.path.replace(':documentId', row.id), {
      method: API_ROUTES.documentDelete.method,
      headers: { [TENANT_HEADER]: tenant.slug, authorization: 'Bearer pat_write_draft' },
    });
    expect(deleteDenied.status).toBe(403);
    expect(await deleteDenied.json()).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const revoked = await buildApp(deps).request(API_ROUTES.documentsCreate.path, {
      method: API_ROUTES.documentsCreate.method,
      headers: {
        [TENANT_HEADER]: tenant.slug,
        authorization: 'Bearer pat_revoked',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Draft',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
        tags: [],
        draft: true,
      }),
    });
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
  });

  it('lists, creates, rejects invalid, and deletes saved searches', async () => {
    const deps = authorizedDeps();
    let seenTenant = '';
    deps.savedSearches.listByTenant = async (tenantId) => {
      seenTenant = tenantId;
      return [
        {
          id: '11111111-1111-4111-8111-111111111111',
          tenantId,
          name: 'Protokoły',
          filter: { docType: 'protokol', tag: 'odbiór', signatureStatus: 'signed' },
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ];
    };
    deps.savedSearches.create = async (input) => ({
      ...input,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    deps.savedSearches.delete = async (tenantId, savedSearchId) =>
      tenantId === tenant.id && savedSearchId === '11111111-1111-4111-8111-111111111111';

    const list = await buildApp(deps).request(API_ROUTES.savedSearches.path, {
      headers: { [TENANT_HEADER]: tenant.slug },
    });
    expect(list.status).toBe(200);
    expect(seenTenant).toBe(tenant.id);
    expect(await list.json()).toMatchObject({
      ok: true,
      data: { savedSearches: [{ name: 'Protokoły' }] },
    });

    const create = await buildApp(deps).request(API_ROUTES.savedSearchesCreate.path, {
      method: API_ROUTES.savedSearchesCreate.method,
      headers: { [TENANT_HEADER]: tenant.slug, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Umowy Anny',
        filter: { docType: 'umowa-uod', person: 'Anna' },
      }),
    });
    expect(create.status).toBe(200);
    expect(await create.json()).toMatchObject({
      ok: true,
      data: { savedSearch: { tenantId: tenant.id, name: 'Umowy Anny' } },
    });

    const invalid = await buildApp(deps).request(API_ROUTES.savedSearchesCreate.path, {
      method: API_ROUTES.savedSearchesCreate.method,
      headers: { [TENANT_HEADER]: tenant.slug, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Błędne daty',
        filter: { dateFrom: '2026-08-02', dateTo: '2026-08-01' },
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });

    const deleted = await buildApp(deps).request(
      '/api/saved-searches/11111111-1111-4111-8111-111111111111',
      {
        method: API_ROUTES.savedSearchDelete.method,
        headers: { [TENANT_HEADER]: tenant.slug },
      },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ ok: true, data: { deleted: true } });
  });

  it('rejects anonymous saved search access with the unauthorized taxonomy', async () => {
    const response = await buildApp(baseDeps()).request(API_ROUTES.savedSearches.path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });

  it('returns contract envelopes for unknown API routes and thrown dependencies', async () => {
    const unknown = await buildApp(authorizedDeps()).request('/api/removed-surface', {
      headers: { [TENANT_HEADER]: tenant.slug },
    });
    expect(unknown.status).toBe(404);
    expect(looseEnvelopeSchema.parse(await unknown.json())).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });

    const deps = baseDeps();
    deps.health = { pingDatabase: async () => Promise.reject(new Error('down')) };
    const failure = await buildApp(deps).request(API_PATHS.health);
    expect(failure.status).toBe(500);
    expect(await failure.json()).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('applies security and no-store headers', async () => {
    const response = await buildApp(baseDeps()).request(API_PATHS.health);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});
