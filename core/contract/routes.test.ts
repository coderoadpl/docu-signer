import { describe, expect, it } from 'vitest';

import {
  API_PATHS,
  API_ROUTES,
  documentCreateInputSchema,
  documentListInputSchema,
  exportDocumentsInputSchema,
  fileUploadRequestInputSchema,
  finalizeFileUploadInputSchema,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  meOutputSchema,
  publicVersionSchema,
  savedSearchCreateInputSchema,
  savedSearchListOutputSchema,
  publicTenantDiscoveryPath,
  publicTenantProfilePath,
} from './routes.js';

describe('API route contract', () => {
  it('contains health, identity, document, and saved search routes only', () => {
    expect(Object.keys(API_PATHS).sort()).toEqual([
      'config',
      'documents',
      'health',
      'healthLive',
      'healthReady',
      'me',
    ]);
    expect(API_ROUTES.documents).toEqual({ method: 'GET', path: '/api/documents' });
    expect(API_ROUTES.documentsCreate).toEqual({
      method: 'POST',
      path: '/api/documents',
    });
    expect(API_ROUTES.documentFileMove).toEqual({
      method: 'POST',
      path: '/api/documents/:documentId/files/:fileId/move',
    });
    expect(API_ROUTES.savedSearches).toEqual({
      method: 'GET',
      path: '/api/saved-searches',
    });
    expect(API_ROUTES.savedSearchDelete).toEqual({
      method: 'DELETE',
      path: '/api/saved-searches/:savedSearchId',
    });
  });

  it('validates document writes and trusted archive identity', () => {
    expect(
      documentCreateInputSchema.safeParse({
        title: 'Umowa',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
        tags: [],
      }).success,
    ).toBe(true);
    expect(
      meOutputSchema.safeParse({
        userId: 'u1',
        email: 'user@example.com',
        name: 'User',
        tenant: {
          id: 'tenant-default',
          slug: 'default',
          name: 'Archive',
          staffRole: 'owner',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid health and readiness payloads', () => {
    const health = { status: 'ok', version: '0.1.0', sha: 'deadbeef', database: 'up' };
    expect(healthOutputSchema.parse(health)).toEqual(health);
    expect(healthOutputSchema.safeParse({ ...health, database: 'down' }).success).toBe(true);
    expect(healthOutputSchema.safeParse({ ...health, database: 'sideways' }).success).toBe(false);
    expect(healthOutputSchema.safeParse({ ...health, sha: undefined }).success).toBe(false);
    expect(healthReadyOutputSchema.parse(health)).toEqual(health);
    expect(healthReadyOutputSchema.safeParse({ ...health, database: 'down' }).success).toBe(false);
    expect(
      healthLiveOutputSchema.safeParse({ status: 'ok', version: '0.1.0', sha: undefined }).success,
    ).toBe(false);
  });

  it('rejects invalid identity payloads', () => {
    const identity = {
      userId: 'u1',
      email: 'user@example.com',
      name: 'User',
      tenant: {
        id: 'tenant-default',
        slug: 'default',
        name: 'Archive',
        staffRole: 'owner',
      },
    };
    expect(meOutputSchema.safeParse({ ...identity, tenant: null }).success).toBe(true);
    expect(
      meOutputSchema.safeParse({
        ...identity,
        tenant: { ...identity.tenant, staffRole: 'member' },
      }).success,
    ).toBe(false);
    expect(
      meOutputSchema.safeParse({ ...identity, tenant: { id: 'tenant-default' } }).success,
    ).toBe(false);
  });

  it('rejects invalid document filters and writes', () => {
    expect(
      documentListInputSchema.safeParse({ dateFrom: '2026-08-02', dateTo: '2026-08-01' })
        .success,
    ).toBe(false);
    expect(
      documentCreateInputSchema.safeParse({
        title: '   ',
        docType: 'umowa-uod',
        documentDate: '2026-08-01',
      }).success,
    ).toBe(false);
    expect(
      documentCreateInputSchema.safeParse({
        title: 'Umowa',
        docType: 'contract',
        documentDate: '2026-08-01',
      }).success,
    ).toBe(false);
    expect(
      documentCreateInputSchema.safeParse({
        title: 'Umowa',
        docType: 'umowa-uod',
        documentDate: '01-08-2026',
      }).success,
    ).toBe(false);
  });

  it('validates saved search payloads and responses', () => {
    expect(
      savedSearchCreateInputSchema.parse({
        name: 'Protokoły',
        filter: { docType: 'protokol', tag: 'odbiór' },
      }),
    ).toEqual({
      name: 'Protokoły',
      filter: { docType: 'protokol', tag: 'odbiór' },
    });
    expect(
      savedSearchListOutputSchema.safeParse({
        savedSearches: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: 'tenant-default',
            name: 'Protokoły',
            filter: { docType: 'protokol' },
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(savedSearchCreateInputSchema.safeParse({ name: '', filter: {} }).success).toBe(false);
    expect(
      savedSearchCreateInputSchema.safeParse({
        name: 'Błędny typ',
        filter: { docType: 'contract' },
      }).success,
    ).toBe(false);
    expect(
      savedSearchCreateInputSchema.safeParse({
        name: 'Błędne daty',
        filter: { dateFrom: '2026-08-02', dateTo: '2026-08-01' },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid attachment and export inputs', () => {
    expect(
      fileUploadRequestInputSchema.safeParse({
        fileName: 'agreement.txt',
        contentType: 'text/plain',
        role: 'source',
      }).success,
    ).toBe(false);
    expect(
      finalizeFileUploadInputSchema.safeParse({
        key: 'documents/default/document/file',
        fileName: 'agreement.pdf',
        contentType: 'application/pdf',
        sizeBytes: 25 * 1024 * 1024 + 1,
        role: 'source',
      }).success,
    ).toBe(false);
    expect(exportDocumentsInputSchema.safeParse({ documentIds: [] }).success).toBe(false);
    expect(exportDocumentsInputSchema.safeParse({ documentIds: ['not-a-uuid'] }).success).toBe(
      false,
    );
  });

  it('builds encoded public paths', () => {
    expect(publicTenantDiscoveryPath('default')).toBe('/api/public/tenants/default');
    expect(publicTenantProfilePath('default', 'v1')).toBe(
      '/api/public/tenants/default/v/v1',
    );
    expect(publicVersionSchema.safeParse('V1').success).toBe(false);
  });
});
