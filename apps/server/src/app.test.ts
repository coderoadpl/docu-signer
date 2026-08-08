import { describe, expect, it } from 'vitest';

import { BETTER_AUTH_API_PATH_PATTERN, createAuth } from '#adapters/auth/create-auth.js';
import { createDb } from '#adapters/db/client.js';
import {
  API_PATHS,
  API_ROUTES,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  looseEnvelopeSchema,
  memberListOutputSchema,
  staffGrantOutputSchema,
  staffListOutputSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';
import type { AuthenticatedUser } from '#core/server/index.js';
import { ok, type DocumentFile } from '#core/domain/index.js';

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
    rateLimitEnabled: false,
    trustedOrigins: [],
    secureCookies: false,
    email: { sendMail: async () => {} },
  },
);

const baseDeps = (): AppDeps => ({
  auth,
  authPort: { getAuthenticatedUser: async () => null },
  email: { sendMail: async () => {} },
  googleEnabled: false,
  todos: {
    listByTenant: async () => [],
    create: async () => {},
  },
  cards: {
    listByTenant: async () => [],
    create: async () => {},
    updatePositions: async () => {},
  },
  documents: {
    listByTenant: async () => [],
    findById: async () => null,
    listFiles: async () => [],
    listFilesForDocuments: async () => [],
    create: async () => {
      throw new Error('not implemented in fake');
    },
    update: async () => null,
    delete: async () => false,
    createFile: async () => null,
    findFile: async () => null,
    deleteFile: async () => false,
  },
  storage: {
    put: async () => ok(undefined),
    get: async () => ok(null),
    exists: async () => ok(false),
    delete: async () => ok(undefined),
    createUploadUrl: async () => ok(null),
  },
  members: {
    listByTenant: async () => [],
    findByEmail: async () => null,
    findByTenantAndId: async () => null,
    create: async () => {},
    update: async () => {},
    deleteByTenantAndId: async () => 0,
  },
  staff: {
    listByTenant: async () => [],
    findGrant: async () => null,
    grant: async () => {},
    revokeLastOwnerSafe: async () => 0,
  },
  users: {
    findByEmail: async () => null,
  },
  tenantDomains: {
    findByDomain: async () => null,
    listVerifiedDomains: async () => [],
    listByTenant: async () => [],
    findAnyByDomain: async () => null,
    findByTenantAndDomain: async () => null,
    add: async (input) => input,
    setVerified: async () => null,
    removeByTenantAndDomain: async () => 0,
  },
  domainTarget: { cname: null, ip: null },
  domainPort: {
    provision: async () => {},
    remove: async () => {},
    check: async () => ({ resolved: true, detail: 'noop' }),
  },
  tenants: {
    findById: async () => null,
    findBySlug: async () => null,
    createTenantWithOwner: async () => {
      throw new Error('not implemented in fake');
    },
    deleteTenant: async () => {
      throw new Error('not implemented in fake');
    },
  },
  tenantAccess: {
    listTenantsForStaff: async () => [],
    findStaffGrant: async () => null,
    findMember: async () => null,
  },
  health: { pingDatabase: async () => true },
  backfills: {
    loadCheckpoint: async () => null,
    saveCheckpoint: async () => {},
    normalizeMemberEmails: async () => ({ processed: 0, nextCursor: null, done: true }),
  },
  backfillSecret: null,
  ids: { nextId: () => 'test-id' },
  clock: { nowIso: () => '2026-07-15T00:00:00.000Z' },
  baseDomain: 'localhost',
  tenantCreationMode: 'open',
  commitSha: 'test-sha',
});

const user: AuthenticatedUser = {
  userId: 'user-1',
  email: 'demo@agentproofarch.dev',
  name: 'Demo',
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
    expect(csp).toContain("connect-src 'self' https://vercel.com");
    expect(csp).toContain("object-src 'self'");
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

  it('answers an unknown /api/* path with a not_found envelope, never a bare text/plain 404', async () => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    const res = await buildApp(deps).request('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('not_found');
  });

  it('exposes the unauthenticated config flags (googleEnabled) without a session', async () => {
    const deps = baseDeps();
    deps.googleEnabled = true;
    const res = await buildApp(deps).request(API_PATHS.config);
    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body).toMatchObject({ ok: true, data: { googleEnabled: true } });
  });

  it('mounts the Vercel backfill route only with a secret and gates it on that secret', async () => {
    // No secret → the route is never registered, so the request falls through to
    // the authenticated /api/* middleware (401), not the backfill handler.
    const withoutSecret = baseDeps();
    const unmounted = await buildApp(withoutSecret).request(
      '/api/internal/backfills/members-email-normalize',
      { method: 'POST' },
    );
    expect(unmounted.status).toBe(401);

    const secret = 'a-strong-shared-secret-value-1234';
    const deps = baseDeps();
    deps.backfillSecret = secret;
    const app = buildApp(deps);

    // Missing/wrong secret header → unauthorized.
    const forbidden = await app.request('/api/internal/backfills/members-email-normalize', {
      method: 'POST',
    });
    expect(forbidden.status).toBe(401);

    // Correct secret + a registered backfill → 200 with the batch progress.
    const okRes = await app.request('/api/internal/backfills/members-email-normalize', {
      method: 'POST',
      headers: { 'x-internal-secret': secret },
    });
    expect(okRes.status).toBe(200);
    const okBody = looseEnvelopeSchema.parse(await okRes.json());
    expect(okBody.ok).toBe(true);

    // Correct secret + an unknown backfill → not_found envelope.
    const unknown = await app.request('/api/internal/backfills/no-such-backfill', {
      method: 'POST',
      headers: { 'x-internal-secret': secret },
    });
    expect(unknown.status).toBe(404);
    const unknownBody = looseEnvelopeSchema.parse(await unknown.json());
    if (!unknownBody.ok) expect(unknownBody.error.code).toBe('not_found');
  });

  it('answers a wrong method on a known route (POST /api/me) with a not_found envelope', async () => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    const res = await buildApp(deps).request(API_PATHS.me, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('not_found');
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
      expect(health.sha).toBe('test-sha');
    }
  });

  it('liveness is 200 with attestation and never touches the database', async () => {
    const deps = baseDeps();
    deps.health = {
      pingDatabase: async () => {
        throw new Error('the DB must not be pinged for liveness');
      },
    };
    const res = await buildApp(deps).request(API_PATHS.healthLive);

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    if (body.ok) {
      const live = healthLiveOutputSchema.parse(body.data);
      expect(live.sha).toBe('test-sha');
      expect(live.version).toBeTruthy();
    }
  });

  it('readiness is 200 with database up when the ping succeeds', async () => {
    const res = await buildApp(baseDeps()).request(API_PATHS.healthReady);

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    if (body.ok) {
      const ready = healthReadyOutputSchema.parse(body.data);
      expect(ready.database).toBe('up');
      expect(ready.sha).toBe('test-sha');
    }
  });

  it('readiness is a 503 unavailable envelope when the database is down', async () => {
    const deps = baseDeps();
    deps.health = { pingDatabase: async () => false };
    const res = await buildApp(deps).request(API_PATHS.healthReady);

    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('unavailable');
  });

  const acme = { id: 't-acme', slug: 'acme', name: 'Acme Inc' };
  const asStaff = (): AppDeps => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    deps.tenants = { ...deps.tenants, findBySlug: async () => acme };
    deps.tenantAccess = {
      ...deps.tenantAccess,
      findStaffGrant: async () => ({ tenant: acme, staffRole: 'owner' }),
    };
    return deps;
  };

  it('serves the members list to resolved staff (member:read)', async () => {
    const deps = asStaff();
    deps.members = {
      ...deps.members,
      listByTenant: async () => [
        {
          id: 'm-1',
          tenantId: 't-acme',
          userId: null,
          email: 'alice@example.com',
          displayName: 'Alice',
          tags: [],
          marketingConsents: [],
          externalCustomerIds: [],
          createdAt: '2026-07-10T00:00:00.000Z',
          lastSeenAt: null,
        },
      ],
    };
    const res = await buildApp(deps).request(API_PATHS.members, {
      headers: { [TENANT_HEADER]: 'acme' },
    });

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    if (body.ok) expect(memberListOutputSchema.parse(body.data).members).toHaveLength(1);
  });

  it('serves the complete staff-only document route lifecycle', async () => {
    const deps = asStaff();
    const documentId = '11111111-1111-4111-8111-111111111111';
    const fileId = '22222222-2222-4222-8222-222222222222';
    const storageKey = `documents/t-acme/${documentId}/${fileId}`;
    const document = {
      id: documentId,
      tenantId: 't-acme',
      title: 'Agreement',
      docType: 'umowa-uod' as const,
      documentDate: '2026-07-27',
      person: null,
      tags: [],
      createdAt: '2026-07-27T10:00:00.000Z',
      updatedAt: '2026-07-27T10:00:00.000Z',
    };
    const files: DocumentFile[] = [];
    deps.ids = { nextId: () => (files.length === 0 ? fileId : documentId) };
    deps.documents = {
      listByTenant: async () => [document],
      findById: async (_tenantId, id) => (id === documentId ? document : null),
      listFiles: async () => files,
      listFilesForDocuments: async () => files,
      create: async () => document,
      update: async () => ({ ...document, title: 'Updated' }),
      delete: async () => true,
      createFile: async (_tenantId, input) => {
        const file = {
          ...input,
          id: fileId,
          createdAt: '2026-07-27T10:00:00.000Z',
        };
        files.splice(0, files.length, file);
        return file;
      },
      findFile: async () => files[0] ?? null,
      deleteFile: async () => {
        files.splice(0);
        return true;
      },
    };
    deps.storage = {
      put: async () => ok(undefined),
      get: async () => ok(new Uint8Array([1, 2, 3])),
      exists: async () => ok(true),
      delete: async () => ok(undefined),
      createUploadUrl: async () => ok(null),
    };
    const app = buildApp(deps);
    const headers = { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' };
    const entryBody = JSON.stringify({
      title: document.title,
      docType: document.docType,
      documentDate: document.documentDate,
      tags: [],
    });
    expect(
      (
        await app.request(API_PATHS.documents, {
          method: 'POST',
          headers,
          body: entryBody,
        })
      ).status,
    ).toBe(200);
    expect((await app.request(API_PATHS.documents, { headers })).status).toBe(200);
    const documentPath = API_ROUTES.document.path.replace(':documentId', documentId);
    expect((await app.request(documentPath, { headers })).status).toBe(200);
    expect(
      (
        await app.request(documentPath, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            title: 'Updated',
            docType: document.docType,
            documentDate: document.documentDate,
            tags: [],
          }),
        })
      ).status,
    ).toBe(200);
    const uploadRequestPath = API_ROUTES.documentFileUploadRequest.path.replace(
      ':documentId',
      documentId,
    );
    const uploadRequest = await app.request(uploadRequestPath, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fileName: 'scan.png',
        contentType: 'image/png',
        role: 'source',
      }),
    });
    expect(uploadRequest.status).toBe(200);
    const finalizePath = API_ROUTES.documentFileFinalize.path.replace(':documentId', documentId);
    expect(
      (
        await app.request(finalizePath, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            key: storageKey,
            fileName: 'scan.png',
            contentType: 'image/png',
            sizeBytes: 3,
            role: 'source',
          }),
        })
      ).status,
    ).toBe(200);
    const uploadPath = API_ROUTES.documentFileServerUpload.path.replace(
      ':documentId',
      documentId,
    );
    expect(
      (
        await app.request(`${uploadPath}?fileName=scan.png&role=source`, {
          method: 'POST',
          headers: { [TENANT_HEADER]: 'acme', 'content-type': 'image/png' },
          body: new Uint8Array([1, 2, 3]),
        })
      ).status,
    ).toBe(200);
    const filePath = (template: string) =>
      template.replace(':documentId', documentId).replace(':fileId', fileId);
    expect(
      (await app.request(filePath(API_ROUTES.documentFileContent.path), { headers })).status,
    ).toBe(200);
    expect(
      (await app.request(filePath(API_ROUTES.documentFileExport.path), { headers })).status,
    ).toBe(200);
    expect(
      (
        await app.request(API_ROUTES.documentsExport.path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ documentIds: [documentId] }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(filePath(API_ROUTES.documentFileDelete.path), {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(documentPath, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(200);
  });

  it('returns validation envelopes for every malformed document mutation boundary', async () => {
    const app = buildApp(asStaff());
    const documentId = '11111111-1111-4111-8111-111111111111';
    const headers = { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' };
    const documentPath = API_ROUTES.document.path.replace(':documentId', documentId);
    const requests = [
      app.request(`${API_PATHS.documents}?dateFrom=2026-07-28&dateTo=2026-07-27`, {
        headers,
      }),
      app.request(API_PATHS.documents, { method: 'POST', headers, body: '{}' }),
      app.request(documentPath, { method: 'PATCH', headers, body: '{}' }),
      app.request(
        API_ROUTES.documentFileUploadRequest.path.replace(':documentId', documentId),
        { method: 'POST', headers, body: '{}' },
      ),
      app.request(
        API_ROUTES.documentFileFinalize.path.replace(':documentId', documentId),
        { method: 'POST', headers, body: '{}' },
      ),
      app.request(
        `${API_ROUTES.documentFileServerUpload.path.replace(':documentId', documentId)}?fileName=x.exe&role=other`,
        {
          method: 'POST',
          headers: { [TENANT_HEADER]: 'acme', 'content-type': 'application/octet-stream' },
          body: new Uint8Array([1]),
        },
      ),
      app.request(API_ROUTES.documentsExport.path, {
        method: 'POST',
        headers,
        body: '{}',
      }),
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(400);
      expect(looseEnvelopeSchema.parse(await response.json())).toMatchObject({
        ok: false,
        error: { code: 'validation' },
      });
    }
  });

  it('applies the normal body limit to Better Auth routes and the 25MB limit to uploads', async () => {
    const app = buildApp(baseDeps());
    const authResponse = await app.request(
      BETTER_AUTH_API_PATH_PATTERN.replace('*', 'body-limit-probe'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x'.repeat(101 * 1024) }),
      },
    );
    expect(authResponse.status).toBe(400);
    expect(looseEnvelopeSchema.parse(await authResponse.json())).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });

    const uploadPath = API_ROUTES.documentFileServerUpload.path.replace(
      ':documentId',
      '11111111-1111-4111-8111-111111111111',
    );
    const uploadResponse = await app.request(`${uploadPath}?fileName=scan.pdf&role=source`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array(25 * 1024 * 1024 + 1),
    });
    expect(uploadResponse.status).toBe(400);
    expect(looseEnvelopeSchema.parse(await uploadResponse.json())).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('forbids an end-customer member from reading the roster (staff-only capability)', async () => {
    const deps = baseDeps();
    deps.authPort = { getAuthenticatedUser: async () => user };
    deps.tenants = { ...deps.tenants, findBySlug: async () => acme };
    deps.tenantAccess = {
      ...deps.tenantAccess,
      findMember: async () => ({
        id: 'm-1',
        tenantId: 't-acme',
        userId: 'user-1',
        email: 'demo@agentproofarch.dev',
        displayName: null,
        tags: [],
        marketingConsents: [],
        externalCustomerIds: [],
        createdAt: '2026-07-10T00:00:00.000Z',
        lastSeenAt: null,
      }),
    };
    const res = await buildApp(deps).request(API_PATHS.members, {
      headers: { [TENANT_HEADER]: 'acme' },
    });

    expect(res.status).toBe(403);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe('forbidden');
  });

  const asAdmin = (): AppDeps => {
    const deps = asStaff();
    deps.tenantAccess = {
      ...deps.tenantAccess,
      findStaffGrant: async () => ({ tenant: acme, staffRole: 'admin' }),
    };
    return deps;
  };

  it('lets an owner grant admin access to an existing account (FR-8)', async () => {
    const deps = asStaff();
    deps.users = { findByEmail: async () => ({ userId: 'u-new', email: 'carlos@example.com', name: 'Carlos' }) };
    const res = await buildApp(deps).request(API_PATHS.staff, {
      method: 'POST',
      headers: { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'carlos@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    expect(body.ok).toBe(true);
    if (body.ok) {
      const parsed = staffGrantOutputSchema.parse(body.data);
      expect(parsed).toMatchObject({ granted: true, staff: { role: 'admin', email: 'carlos@example.com' } });
    }
  });

  it('returns not_found when granting to an email with no account (no invitations)', async () => {
    const deps = asStaff();
    deps.users = { findByEmail: async () => null };
    const res = await buildApp(deps).request(API_PATHS.staff, {
      method: 'POST',
      headers: { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@example.com' }),
    });

    expect(res.status).toBe(404);
    const body = looseEnvelopeSchema.parse(await res.json());
    if (!body.ok) expect(body.error.code).toBe('not_found');
  });

  it('forbids an admin from granting staff access (owner-only)', async () => {
    const deps = asAdmin();
    deps.users = { findByEmail: async () => ({ userId: 'u-new', email: 'carlos@example.com', name: 'Carlos' }) };
    const res = await buildApp(deps).request(API_PATHS.staff, {
      method: 'POST',
      headers: { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'carlos@example.com' }),
    });

    expect(res.status).toBe(403);
    const body = looseEnvelopeSchema.parse(await res.json());
    if (!body.ok) expect(body.error.code).toBe('forbidden');
  });

  it('serves the staff roster to a resolved admin (staff:read is shared)', async () => {
    const deps = asAdmin();
    deps.staff = {
      ...deps.staff,
      listByTenant: async () => [
        { id: 'g-1', userId: 'user-1', email: 'demo@agentproofarch.dev', name: 'Demo', role: 'owner' },
      ],
    };
    const res = await buildApp(deps).request(API_PATHS.staff, {
      headers: { [TENANT_HEADER]: 'acme' },
    });

    expect(res.status).toBe(200);
    const body = looseEnvelopeSchema.parse(await res.json());
    if (body.ok) expect(staffListOutputSchema.parse(body.data).staff).toHaveLength(1);
  });

  it('blocks revoking the last owner with a validation envelope (lockout guard)', async () => {
    const deps = asStaff();
    deps.staff = {
      ...deps.staff,
      findGrant: async () => ({ id: 'g-owner', userId: 'user-1', role: 'owner' }),
      revokeLastOwnerSafe: async () => 0,
    };
    const res = await buildApp(deps).request(API_PATHS.staffRevoke, {
      method: 'POST',
      headers: { [TENANT_HEADER]: 'acme', 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    });

    expect(res.status).toBe(400);
    const body = looseEnvelopeSchema.parse(await res.json());
    if (!body.ok) expect(body.error.code).toBe('validation');
  });
});
