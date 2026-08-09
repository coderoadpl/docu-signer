import { describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import {
  API_PATHS,
  API_ROUTES,
  looseEnvelopeSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';
import { ok, type Document, type DocumentListFilter } from '#core/domain/index.js';
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
    findById: async () => null,
    listFiles: async () => [],
    listFilesForDocuments: async () => [],
    create: async () => {
      throw new Error('not implemented');
    },
    update: async () => null,
    approve: async () => null,
    delete: async () => false,
    createFile: async () => null,
    findFile: async () => null,
    moveFileToDocument: async () => null,
    deleteFile: async () => false,
  },
  savedSearches: {
    listByTenant: async () => [],
    create: async (input) => ({
      ...input,
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
    delete: async () => false,
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
