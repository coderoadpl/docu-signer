import { describe, expect, it } from 'vitest';

import { createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import {
  API_PATHS,
  API_ROUTES,
  healthOutputSchema,
  looseEnvelopeSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';
import type { AuthenticatedUser } from '#core/server/index.js';
import { ok } from '#core/domain/index.js';

import { buildApp } from './app.js';
import type { AppDeps } from './composition.js';

// A real Better Auth instance satisfies the AppDeps.auth field without a cast.
// It is never exercised here: no test hits the auth handler route, and the
// lazy pg pool behind it opens no connection.
const auth = createAuth(
  createDb('node-postgres', 'postgresql://user:pass@localhost:5432/agentproofarch_test'),
  {
    secret: 'test-secret-value-that-is-at-least-32-chars',
    baseUrl: 'http://localhost',
    baseDomain: 'localhost',
    trustedOrigins: [],
    secureCookies: false,
  },
);

const baseDeps = (): AppDeps => ({
  auth,
  authPort: { getAuthenticatedUser: async () => null },
  todos: {
    listByTenant: async () => [],
    create: async () => {},
  },
  documents: {
    listByTenant: async () => ok([]),
    findById: async () => ok(null),
    listFiles: async () => ok([]),
    create: async () => ok({
      id: 'document-1',
      tenantId: 'tenant-default',
      title: 'Document',
      docType: 'inny',
      documentDate: '2026-07-18',
      tags: [],
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    }),
    update: async () => ok(null),
    delete: async () => ok(false),
    createFile: async () => ok(null),
    findFile: async () => ok(null),
    deleteFile: async () => ok(false),
  },
  storage: {
    put: async () => ok(undefined),
    get: async () => ok(null),
    delete: async () => ok(undefined),
    createUploadUrl: async () => ok(null),
  },
  tenantDomains: {
    findByDomain: async () => null,
    listVerifiedDomains: async () => [],
  },
  tenants: {
    findById: async () => null,
    findBySlug: async () => null,
    createTenant: async () => {
      throw new Error('not implemented in fake');
    },
    createOwnerGrant: async () => {
      throw new Error('not implemented in fake');
    },
  },
  tenantAccess: {
    listTenantsForStaff: async () => [],
    findStaffGrant: async () => null,
    findMember: async () => null,
  },
  health: { pingDatabase: async () => true },
  ids: { nextId: () => 'test-id' },
  clock: { nowIso: () => '2026-07-15T00:00:00.000Z' },
  baseDomain: 'localhost',
});

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
};

const document = {
  id: 'document-1',
  tenantId: 'tenant-default',
  title: 'Agreement',
  docType: 'umowa-uod' as const,
  documentDate: '2026-07-18',
  tags: [],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
};

const file = {
  id: 'file-1',
  documentId: document.id,
  role: 'source' as const,
  fileName: 'source.pdf',
  contentType: 'application/pdf',
  sizeBytes: 3,
  storageKey: 'documents/tenant-default/document-1/storage-id',
  createdAt: '2026-07-18T00:00:00.000Z',
};

const authenticatedDeps = (): AppDeps => {
  const deps = baseDeps();
  deps.authPort = { getAuthenticatedUser: async () => user };
  deps.tenants.findBySlug = async (slug) =>
    slug === 'default' ? { id: 'tenant-default', slug: 'default', name: 'Default' } : null;
  deps.documents = {
    listByTenant: async () => ok([document]),
    findById: async (_tenantId, documentId) => ok(documentId === document.id ? document : null),
    listFiles: async () => ok([file]),
    create: async () => ok(document),
    update: async () => ok(document),
    delete: async () => ok(true),
    createFile: async () => ok(file),
    findFile: async () => ok(file),
    deleteFile: async () => ok(true),
  };
  return deps;
};

describe('buildApp routes', () => {
  it('answers an over-100KB POST with a validation envelope, never a bare 413', async () => {
    const oversized = JSON.stringify({ slug: 'a', name: 'x'.repeat(200 * 1024) });
    const res = await buildApp(baseDeps()).request(API_PATHS.tenants, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized,
    });

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(413);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('validation');
  });

  it('answers a malformed JSON body with a validation envelope', async () => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    const res = await buildApp(deps).request(API_PATHS.tenants, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'this is not json at all',
    });

    expect(res.status).toBe(400);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('validation');
  });

  it('resolves an unknown tenant header to a tenant_not_found error', async () => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    const res = await buildApp(deps).request(API_PATHS.todos, {
      headers: { [TENANT_HEADER]: 'ghost-tenant' },
    });

    expect(res.status).toBe(404);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('tenant_not_found');
  });

  it('surfaces a thrown dependency as an internal envelope through onError', async () => {
    const deps = baseDeps();
    deps.health = {
      pingDatabase: async () => {
        throw new Error('database connection exploded');
      },
    };
    const res = await buildApp(deps).request(API_PATHS.health);

    expect(res.status).toBe(500);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('internal');
  });

  it('sets the security baseline headers on API responses', async () => {
    const res = await buildApp(baseDeps()).request(API_PATHS.health);

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('marks both success and error responses no-store', async () => {
    const successRes = await buildApp(baseDeps()).request(API_PATHS.health);
    expect(successRes.status).toBe(200);
    expect(successRes.headers.get('cache-control')).toBe('no-store');

    const errorRes = await buildApp(baseDeps()).request(API_PATHS.me);
    expect(errorRes.status).toBe(401);
    expect(errorRes.headers.get('cache-control')).toBe('no-store');
  });

  it('reports the database as down when the health ping fails', async () => {
    const deps = baseDeps();
    deps.health = { pingDatabase: async () => false };
    const res = await buildApp(deps).request(API_PATHS.health);

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    if (body.ok) {
      const health = healthOutputSchema.parse(body.data);
      expect(health.database).toBe('down');
    }
  });

  it('serves document CRUD and file command routes', async () => {
    const app = buildApp(authenticatedDeps());
    const createResponse = await app.request(API_PATHS.documents, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Agreement', docType: 'umowa-uod', documentDate: '2026-07-18' }),
    });
    expect(createResponse.status).toBe(200);
    expect((await createResponse.json())).toMatchObject({ ok: true, data: { document: { id: 'document-1' } } });

    expect((await app.request(`${API_PATHS.documents}?docType=umowa-uod`)).status).toBe(200);
    const detailPath = API_ROUTES.document.path.replace(':documentId', document.id);
    expect((await app.request(detailPath)).status).toBe(200);
    expect(
      (
        await app.request(detailPath, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Agreement', docType: 'umowa-uod', documentDate: '2026-07-18' }),
        })
      ).status,
    ).toBe(200);

    const uploadRequestPath = API_ROUTES.documentFileUploadRequest.path.replace(':documentId', document.id);
    expect(
      (
        await app.request(uploadRequestPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fileName: 'source.pdf', contentType: 'application/pdf', role: 'source' }),
        })
      ).status,
    ).toBe(200);

    const finalizePath = API_ROUTES.documentFileFinalize.path.replace(':documentId', document.id);
    expect(
      (
        await app.request(finalizePath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key: 'documents/tenant-default/document-1/storage-id',
            fileName: 'source.pdf',
            contentType: 'application/pdf',
            sizeBytes: 3,
            role: 'source',
          }),
        })
      ).status,
    ).toBe(200);

    const serverUploadPath = API_ROUTES.documentFileServerUpload.path.replace(':documentId', document.id);
    expect(
      (
        await app.request(`${serverUploadPath}?fileName=source.pdf&role=source`, {
          method: 'POST',
          headers: { 'content-type': 'application/pdf' },
          body: new Uint8Array([1, 2, 3]),
        })
      ).status,
    ).toBe(200);

    const removePath = API_ROUTES.documentFileDelete.path
      .replace(':documentId', document.id)
      .replace(':fileId', file.id);
    expect((await app.request(removePath, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(detailPath, { method: 'DELETE' })).status).toBe(200);
  });

  it('exposes the constant default tenant in me', async () => {
    const response = await buildApp(authenticatedDeps()).request(API_PATHS.me);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { tenant: { id: 'tenant-default', slug: 'default' } },
    });
  });

  it('returns validation envelopes for malformed document commands', async () => {
    const app = buildApp(authenticatedDeps());
    const invalidRequests = [
      app.request(`${API_PATHS.documents}?dateFrom=2026-07-19&dateTo=2026-07-18`),
      app.request(API_PATHS.documents, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request(API_ROUTES.documentUpdate.path.replace(':documentId', document.id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request(API_ROUTES.documentFileUploadRequest.path.replace(':documentId', document.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request(API_ROUTES.documentFileFinalize.path.replace(':documentId', document.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      app.request(`${API_ROUTES.documentFileServerUpload.path.replace(':documentId', document.id)}?role=source`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: new Uint8Array([1]),
      }),
    ];
    const responses = await Promise.all(invalidRequests);
    expect(responses.every((response) => response.status === 400)).toBe(true);
  });
});
