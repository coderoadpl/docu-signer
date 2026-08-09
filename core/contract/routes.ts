import { z } from 'zod';

import {
  createDocumentSchema,
  documentFileSchema,
  documentListFilterSchema,
  documentSchema,
  documentWithFilesSchema,
  exportDocumentsSchema,
  fileUploadRequestSchema,
  finalizeFileUploadSchema,
  moveDocumentFileSchema,
  publicTenantProfileSchema,
  staffRoleSchema,
  updateDocumentSchema,
} from '#core/domain/index.js';

const attestationSchema = z.object({
  version: z.string(),
  sha: z.string(),
});

export const healthLiveOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
});

export const healthReadyOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.literal('up'),
});

export const healthOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
});

export const authConfigOutputSchema = z.object({
  googleEnabled: z.boolean(),
});

export const meOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema,
    })
    .nullable(),
});

export const documentListInputSchema = documentListFilterSchema;

export const documentListOutputSchema = z.object({
  documents: z.array(documentWithFilesSchema),
});

export const documentCreateInputSchema = createDocumentSchema;

export const documentCreateOutputSchema = z.object({
  document: documentSchema,
});

export const documentGetOutputSchema = z.object({
  document: documentWithFilesSchema,
});

export const documentUpdateInputSchema = updateDocumentSchema;

export const documentUpdateOutputSchema = z.object({
  document: documentSchema,
});

export const documentDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const fileUploadRequestInputSchema = fileUploadRequestSchema;

export const fileUploadRequestOutputSchema = z.object({
  upload: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('direct'),
      key: z.string(),
      target: z.object({
        url: z.url(),
        method: z.literal('PUT'),
        headers: z.record(z.string(), z.string()),
      }),
    }),
    z.object({ kind: z.literal('server'), key: z.string() }),
  ]),
});

export const finalizeFileUploadInputSchema = finalizeFileUploadSchema;

export const documentFileOutputSchema = z.object({
  file: documentFileSchema,
});

export const serverUploadMetadataSchema = fileUploadRequestSchema;

export const documentFileDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const documentFileMoveInputSchema = moveDocumentFileSchema;

export const documentFileMoveOutputSchema = z.object({
  document: documentWithFilesSchema,
});

export const exportDocumentsInputSchema = exportDocumentsSchema;

export const PUBLIC_API_PREFIX = '/api/public';

export const PUBLIC_API_ROUTES = {
  tenantDiscovery: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug` },
  tenantProfile: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug/v/:version` },
} as const;

export const publicVersionSchema = z
  .string()
  .regex(/^[a-z0-9]+$/, 'A content version is a base36 token');

export const publicTenantDiscoveryOutputSchema = z.object({
  slug: z.string(),
  contentVersion: z.string(),
});

export const publicTenantProfileOutputSchema = publicTenantProfileSchema;

const fillPath = (template: string, params: Record<string, string>): string =>
  template.replace(/:([a-z]+)/gi, (_, key: string) => encodeURIComponent(params[key] ?? ''));

export const publicTenantDiscoveryPath = (slug: string): string =>
  fillPath(PUBLIC_API_ROUTES.tenantDiscovery.path, { slug });

export const publicTenantProfilePath = (slug: string, version: string): string =>
  fillPath(PUBLIC_API_ROUTES.tenantProfile.path, { slug, version });

export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  healthLive: { method: 'GET', path: '/api/health/live' },
  healthReady: { method: 'GET', path: '/api/health/ready' },
  config: { method: 'GET', path: '/api/config' },
  me: { method: 'GET', path: '/api/me' },
  documents: { method: 'GET', path: '/api/documents' },
  documentsCreate: { method: 'POST', path: '/api/documents' },
  document: { method: 'GET', path: '/api/documents/:documentId' },
  documentUpdate: { method: 'PATCH', path: '/api/documents/:documentId' },
  documentDelete: { method: 'DELETE', path: '/api/documents/:documentId' },
  documentFileUploadRequest: {
    method: 'POST',
    path: '/api/documents/:documentId/files/upload-request',
  },
  documentFileFinalize: {
    method: 'POST',
    path: '/api/documents/:documentId/files/finalize',
  },
  documentFileServerUpload: {
    method: 'POST',
    path: '/api/documents/:documentId/files/upload',
  },
  documentFileDelete: {
    method: 'DELETE',
    path: '/api/documents/:documentId/files/:fileId',
  },
  documentFileMove: {
    method: 'POST',
    path: '/api/documents/:documentId/files/:fileId/move',
  },
  documentFileContent: {
    method: 'GET',
    path: '/api/documents/:documentId/files/:fileId/content',
  },
  documentFileExport: {
    method: 'GET',
    path: '/api/documents/:documentId/files/:fileId/export',
  },
  documentsExport: { method: 'POST', path: '/api/export' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  healthLive: API_ROUTES.healthLive.path,
  healthReady: API_ROUTES.healthReady.path,
  config: API_ROUTES.config.path,
  me: API_ROUTES.me.path,
  documents: API_ROUTES.documents.path,
} as const;

export const TENANT_HEADER = 'x-tenant';
