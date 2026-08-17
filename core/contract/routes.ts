import { z } from 'zod';

import {
  apiTokenSchema,
  acceptInvitationSchema,
  bulkApprovePendingDraftsSchema,
  createInvitationSchema,
  createApiTokenSchema,
  createDocumentSchema,
  createDocumentTypeSchema,
  createDocumentCommentSchema,
  createSavedSearchSchema,
  createSignatureRecordSchema,
  createSourceUpdateRequestSchema,
  documentFileSchema,
  documentCommentListItemSchema,
  documentDetailSchema,
  documentMetadataChangesSchema,
  documentMetadataProposalListItemSchema,
  documentLinkSchema,
  documentListItemSchema,
  documentListFilterSchema,
  documentTypeDefinitionSchema,
  linkedDocumentSchema,
  linkDocumentsInputSchema,
  documentSchema,
  documentWithFilesSchema,
  exportDocumentsSchema,
  fileUploadRequestSchema,
  hiddenFilterValueRefSchema,
  hiddenFilterValueSchema,
  invitationSchema,
  finalizeFileUploadSchema,
  padSessionActiveOutputSchema as domainPadSessionActiveOutputSchema,
  padSessionConsumeOutputSchema as domainPadSessionConsumeOutputSchema,
  padSessionCreateInputSchema as domainPadSessionCreateInputSchema,
  padSessionCreateOutputSchema as domainPadSessionCreateOutputSchema,
  padSessionDocumentInputSchema as domainPadSessionDocumentInputSchema,
  padSessionJoinOutputSchema as domainPadSessionJoinOutputSchema,
  padSessionRequestInputSchema as domainPadSessionRequestInputSchema,
  padSessionRequestOutputSchema as domainPadSessionRequestOutputSchema,
  padSessionStateOutputSchema as domainPadSessionStateOutputSchema,
  padSessionSubmissionConsumeOutputSchema as domainPadSessionSubmissionConsumeOutputSchema,
  padStrokeSubmissionSchema as domainPadSessionSubmitInputSchema,
  pdfSealVerificationSchema,
  moveDocumentFileSchema,
  paginationQuerySchema,
  publicTenantProfileSchema,
  publicInvitationSchema,
  savedSearchSchema,
  signatureRecordSchema,
  sourceUpdateRequestSchema,
  decideSourceUpdateRequestSchema,
  completeSourceUpdateRequestSchema,
  setDocumentTypeHiddenSchema,
  setUserPreferenceSchema,
  staffRoleSchema,
  updateDocumentSchema,
  renameDocumentTypeSchema,
  updateTenantSettingsSchema,
  userPreferenceKeySchema,
  userPreferenceSchema,
  tenantSettingsSchema,
  tenantAccountSchema,
} from '#core/domain/index.js';

import { paginatedOutputSchema } from './pagination.js';

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
  passwordResetEnabled: z.boolean(),
  emailConfigured: z.boolean(),
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
  documents: z.array(documentListItemSchema),
});

export const tenantAccountListOutputSchema = z.object({
  accounts: z.array(tenantAccountSchema),
});

export const documentTrashListOutputSchema = z.object({
  documents: z.array(documentWithFilesSchema),
});

export const documentCreateInputSchema = createDocumentSchema;

export const documentCreateOutputSchema = z.object({
  document: documentSchema,
});

export const documentTypeListOutputSchema = z.object({
  documentTypes: z.array(documentTypeDefinitionSchema),
});

export const documentTypeCreateInputSchema = createDocumentTypeSchema;

export const documentTypeCreateOutputSchema = z.object({
  documentType: documentTypeDefinitionSchema,
});

export const documentTypeRenameInputSchema = renameDocumentTypeSchema;

export const documentTypeRenameOutputSchema = z.object({
  documentType: documentTypeDefinitionSchema,
});

export const documentTypeSetHiddenInputSchema = setDocumentTypeHiddenSchema;

export const documentTypeSetHiddenOutputSchema = z.object({
  documentType: documentTypeDefinitionSchema,
});

export const documentTypeDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const hiddenFilterValueListOutputSchema = z.object({
  hiddenFilterValues: z.array(hiddenFilterValueSchema),
});

export const hiddenFilterValueHideInputSchema = hiddenFilterValueRefSchema;

export const hiddenFilterValueHideOutputSchema = z.object({
  hiddenFilterValue: hiddenFilterValueSchema,
});

export const hiddenFilterValueUnhideInputSchema = hiddenFilterValueRefSchema;

export const hiddenFilterValueUnhideOutputSchema = z.object({
  unhidden: z.literal(true),
});

export const documentGetOutputSchema = z.object({ document: documentDetailSchema });

export const documentCommentListInputSchema = paginationQuerySchema;

export const documentCommentListOutputSchema = paginatedOutputSchema(
  documentCommentListItemSchema,
);

export const documentCommentCreateInputSchema = createDocumentCommentSchema;

export const documentCommentCreateOutputSchema = z.object({
  comment: documentCommentListItemSchema,
});

export const documentCommentApproveOutputSchema = z.object({
  comment: documentCommentListItemSchema,
});

export const documentCommentDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const documentUpdateInputSchema = z.union([
  updateDocumentSchema,
  documentMetadataChangesSchema,
]);

export const documentUpdateOutputSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('updated'),
    document: documentSchema,
    proposal: z.null(),
  }),
  z.object({
    outcome: z.literal('proposed'),
    document: documentSchema,
    proposal: documentMetadataProposalListItemSchema,
  }),
]);

export const documentMetadataProposalListInputSchema = paginationQuerySchema;

export const documentMetadataProposalListOutputSchema = paginatedOutputSchema(
  documentMetadataProposalListItemSchema,
);

export const documentMetadataProposalApproveOutputSchema = z.object({
  document: documentSchema,
});

export const bulkPendingDraftApproveInputSchema = bulkApprovePendingDraftsSchema;

export const bulkPendingDraftApproveOutputSchema = z.object({
  approved: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  metadataProposals: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
});

export const documentMetadataProposalRejectOutputSchema = z.object({
  deleted: z.literal(true),
});

export const documentApproveOutputSchema = z.object({
  document: documentSchema,
});

export const documentUnapproveOutputSchema = z.object({
  document: documentSchema,
});

export const documentWaiveSignatureOutputSchema = z.object({
  document: documentSchema,
});

export const documentRequireSignatureOutputSchema = z.object({
  document: documentSchema,
});

export const documentLinkCreateInputSchema = linkDocumentsInputSchema;

export const documentLinkCreateOutputSchema = z.object({
  link: linkedDocumentSchema,
});

export const documentLinkApproveOutputSchema = z.object({
  link: documentLinkSchema,
});

export const documentLinkListOutputSchema = z.object({
  links: z.array(linkedDocumentSchema),
});

export const documentLinkDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const documentDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const documentRestoreOutputSchema = z.object({
  document: documentSchema,
});

export const documentPurgeOutputSchema = z.object({
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

export const documentFileSealOutputSchema = z.object({
  verification: pdfSealVerificationSchema,
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

export const savedSearchListOutputSchema = z.object({
  savedSearches: z.array(savedSearchSchema),
});

export const savedSearchCreateInputSchema = createSavedSearchSchema;

export const savedSearchCreateOutputSchema = z.object({
  savedSearch: savedSearchSchema,
});

export const savedSearchDeleteOutputSchema = z.object({
  deleted: z.literal(true),
});

export const apiTokenCreateInputSchema = createApiTokenSchema;

export const apiTokenCreateOutputSchema = z.object({
  apiToken: apiTokenSchema,
  value: z.string().min(1),
});

export const apiTokenListOutputSchema = z.object({
  apiTokens: z.array(apiTokenSchema),
});

export const apiTokenRevokeOutputSchema = z.object({
  revoked: z.literal(true),
});

export const invitationCreateInputSchema = createInvitationSchema;

export const invitationCreateOutputSchema = z.object({
  invitation: invitationSchema,
  url: z.url(),
  emailSent: z.boolean(),
});

export const invitationListOutputSchema = z.object({
  invitations: z.array(invitationSchema),
});

export const invitationRevokeOutputSchema = z.object({
  revoked: z.literal(true),
});

export const publicInvitationOutputSchema = z.object({
  invitation: publicInvitationSchema,
});

export const invitationAcceptInputSchema = acceptInvitationSchema;

export const invitationAcceptOutputSchema = z.object({
  accepted: z.literal(true),
  email: z.email(),
});

export const userPreferenceKeyInputSchema = userPreferenceKeySchema;

export const userPreferenceGetOutputSchema = z.object({
  preference: userPreferenceSchema.nullable(),
});

export const userPreferenceSetInputSchema = setUserPreferenceSchema;

export const userPreferenceSetOutputSchema = z.object({
  preference: userPreferenceSchema,
});

export const tenantSettingsGetOutputSchema = z.object({
  settings: tenantSettingsSchema,
});

export const tenantSettingsUpdateInputSchema = updateTenantSettingsSchema;

export const tenantSettingsUpdateOutputSchema = z.object({
  settings: tenantSettingsSchema,
});

export const signatureRecordListInputSchema = paginationQuerySchema;

export const signatureRecordSignerBoxEntrySchema = tenantAccountSchema.extend({
  declaredAt: z.iso.datetime(),
});

export type SignatureRecordSignerBoxEntry = z.infer<
  typeof signatureRecordSignerBoxEntrySchema
>;

export const signatureRecordListItemSchema = signatureRecordSchema.extend({
  signerBoxEntries: z.array(signatureRecordSignerBoxEntrySchema).min(1).nullable(),
});

export type SignatureRecordListItem = z.infer<typeof signatureRecordListItemSchema>;

export const signatureRecordListOutputSchema = paginatedOutputSchema(
  signatureRecordListItemSchema,
);

export const signatureRecordCreateInputSchema = createSignatureRecordSchema;

export const signatureRecordCreateOutputSchema = z.object({
  signatureRecord: signatureRecordSchema,
});

export const sourceUpdateRequestGetOutputSchema = z.object({
  request: sourceUpdateRequestSchema.nullable(),
});

export const sourceUpdateRequestListOutputSchema = z.object({
  requests: z.array(sourceUpdateRequestSchema),
});

export const sourceUpdateRequestCreateInputSchema = createSourceUpdateRequestSchema;

export const sourceUpdateRequestDecisionInputSchema = decideSourceUpdateRequestSchema;

export const sourceUpdateRequestCompleteInputSchema = completeSourceUpdateRequestSchema;

export const sourceUpdateRequestOutputSchema = z.object({
  request: sourceUpdateRequestSchema,
});

export const padSessionCreateOutputSchema = domainPadSessionCreateOutputSchema;

export const padSessionCreateInputSchema = domainPadSessionCreateInputSchema;

export const padSessionActiveOutputSchema = domainPadSessionActiveOutputSchema;

export const padSessionJoinOutputSchema = domainPadSessionJoinOutputSchema;

export const padSessionShareOutputSchema = domainPadSessionJoinOutputSchema;

export const padSessionStateOutputSchema = domainPadSessionStateOutputSchema;

export const padSessionRequestInputSchema = domainPadSessionRequestInputSchema;

export const padSessionRequestOutputSchema = domainPadSessionRequestOutputSchema;

export const padSessionDocumentInputSchema = domainPadSessionDocumentInputSchema;

export const padSessionDocumentOutputSchema = domainPadSessionDocumentInputSchema;

export const padSessionSubmitInputSchema = domainPadSessionSubmitInputSchema;

export const padSessionSubmitOutputSchema = z.object({
  submitted: z.literal(true),
});

export const padSessionConsumeOutputSchema = domainPadSessionConsumeOutputSchema;

export const padSessionSubmissionConsumeOutputSchema =
  domainPadSessionSubmissionConsumeOutputSchema;

export const padSessionCloseOutputSchema = z.object({
  closed: z.literal(true),
});

export const padSessionDisconnectOutputSchema = z.object({
  closed: z.literal(true),
});

export const PUBLIC_API_PREFIX = '/api/public';

export const PUBLIC_API_ROUTES = {
  tenantDiscovery: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug` },
  tenantProfile: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug/v/:version` },
  invitation: { method: 'GET', path: `${PUBLIC_API_PREFIX}/invitations/:token` },
  invitationAccept: { method: 'POST', path: `${PUBLIC_API_PREFIX}/invitations/:token/accept` },
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

export const publicInvitationPath = (token: string): string =>
  fillPath(PUBLIC_API_ROUTES.invitation.path, { token });

export const publicInvitationAcceptPath = (token: string): string =>
  fillPath(PUBLIC_API_ROUTES.invitationAccept.path, { token });

export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  healthLive: { method: 'GET', path: '/api/health/live' },
  healthReady: { method: 'GET', path: '/api/health/ready' },
  config: { method: 'GET', path: '/api/config' },
  me: { method: 'GET', path: '/api/me' },
  documents: { method: 'GET', path: '/api/documents' },
  documentsCreate: { method: 'POST', path: '/api/documents' },
  documentTypes: { method: 'GET', path: '/api/document-types' },
  documentTypesCreate: { method: 'POST', path: '/api/document-types' },
  documentTypeRename: { method: 'PATCH', path: '/api/document-types/:slug' },
  documentTypeSetHidden: { method: 'PATCH', path: '/api/document-types/:slug/hidden' },
  documentTypeDelete: { method: 'DELETE', path: '/api/document-types/:slug' },
  hiddenFilterValues: { method: 'GET', path: '/api/hidden-filter-values' },
  hiddenFilterValueHide: { method: 'POST', path: '/api/hidden-filter-values' },
  hiddenFilterValueUnhide: { method: 'POST', path: '/api/hidden-filter-values/unhide' },
  documentsTrash: { method: 'GET', path: '/api/documents/trash' },
  document: { method: 'GET', path: '/api/documents/:documentId' },
  documentComments: { method: 'GET', path: '/api/documents/:documentId/comments' },
  documentCommentCreate: { method: 'POST', path: '/api/documents/:documentId/comments' },
  documentCommentApprove: {
    method: 'POST',
    path: '/api/document-comments/:commentId/approve',
  },
  documentCommentDelete: {
    method: 'DELETE',
    path: '/api/documents/:documentId/comments/:commentId',
  },
  documentUpdate: { method: 'PATCH', path: '/api/documents/:documentId' },
  documentMetadataProposals: {
    method: 'GET',
    path: '/api/documents/:documentId/metadata-proposals',
  },
  documentMetadataProposalApprove: {
    method: 'POST',
    path: '/api/document-metadata-proposals/:proposalId/approve',
  },
  bulkPendingDraftApprove: {
    method: 'POST',
    path: '/api/documents/bulk-approve-pending-drafts',
  },
  documentMetadataProposalReject: {
    method: 'POST',
    path: '/api/document-metadata-proposals/:proposalId/reject',
  },
  documentApprove: { method: 'POST', path: '/api/documents/:documentId/approve' },
  documentUnapprove: { method: 'POST', path: '/api/documents/:documentId/unapprove' },
  documentWaiveSignature: {
    method: 'POST',
    path: '/api/documents/:documentId/waive-signature',
  },
  documentRequireSignature: {
    method: 'POST',
    path: '/api/documents/:documentId/require-signature',
  },
  documentLinks: { method: 'GET', path: '/api/documents/:documentId/links' },
  documentLinkCreate: { method: 'POST', path: '/api/documents/:documentId/links' },
  documentLinkApprove: {
    method: 'POST',
    path: '/api/document-links/:linkId/approve',
  },
  documentLinkDelete: {
    method: 'DELETE',
    path: '/api/documents/:documentId/links/:otherDocumentId',
  },
  documentDelete: { method: 'DELETE', path: '/api/documents/:documentId' },
  documentRestore: { method: 'POST', path: '/api/documents/:documentId/restore' },
  documentPurge: { method: 'DELETE', path: '/api/documents/:documentId/purge' },
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
  documentFileSeal: {
    method: 'GET',
    path: '/api/documents/:documentId/files/:fileId/seal',
  },
  documentFileExport: {
    method: 'GET',
    path: '/api/documents/:documentId/files/:fileId/export',
  },
  documentsExport: { method: 'POST', path: '/api/export' },
  savedSearches: { method: 'GET', path: '/api/saved-searches' },
  savedSearchesCreate: { method: 'POST', path: '/api/saved-searches' },
  savedSearchDelete: { method: 'DELETE', path: '/api/saved-searches/:savedSearchId' },
  apiTokens: { method: 'GET', path: '/api/api-tokens' },
  apiTokensCreate: { method: 'POST', path: '/api/api-tokens' },
  apiTokenRevoke: { method: 'POST', path: '/api/api-tokens/:apiTokenId/revoke' },
  invitations: { method: 'GET', path: '/api/invitations' },
  invitationsCreate: { method: 'POST', path: '/api/invitations' },
  invitationRevoke: { method: 'POST', path: '/api/invitations/:invitationId/revoke' },
  userPreference: { method: 'GET', path: '/api/me/preferences/:key' },
  userPreferenceSet: { method: 'PUT', path: '/api/me/preferences/:key' },
  tenantSettings: { method: 'GET', path: '/api/tenant-settings' },
  tenantAccounts: { method: 'GET', path: '/api/tenant-accounts' },
  tenantSettingsUpdate: { method: 'PUT', path: '/api/tenant-settings' },
  signatureRecords: {
    method: 'GET',
    path: '/api/documents/:documentId/signature-records',
  },
  signatureRecordsCreate: {
    method: 'POST',
    path: '/api/documents/:documentId/signature-records',
  },
  sourceUpdateRequest: {
    method: 'GET',
    path: '/api/documents/:documentId/source-update-request',
  },
  sourceUpdateRequestsPending: {
    method: 'GET',
    path: '/api/source-update-requests/pending',
  },
  sourceUpdateRequestsCreate: {
    method: 'POST',
    path: '/api/documents/:documentId/source-update-requests',
  },
  sourceUpdateRequestDecision: {
    method: 'POST',
    path: '/api/source-update-requests/:requestId/decision',
  },
  sourceUpdateRequestCancel: {
    method: 'POST',
    path: '/api/source-update-requests/:requestId/cancel',
  },
  sourceUpdateRequestComplete: {
    method: 'POST',
    path: '/api/source-update-requests/:requestId/complete',
  },
  padSessionsCreate: { method: 'POST', path: '/api/pad-sessions' },
  padSessionActive: { method: 'GET', path: '/api/pad-sessions/active' },
  padSessionJoin: { method: 'POST', path: '/api/pad-sessions/join' },
  padSessionShare: { method: 'POST', path: '/api/pad-sessions/:sessionId/share' },
  padSessionState: { method: 'GET', path: '/api/pad-sessions/:sessionId/state' },
  padSessionRequest: { method: 'POST', path: '/api/pad-sessions/:sessionId/request' },
  padSessionDocument: { method: 'POST', path: '/api/pad-sessions/:sessionId/document' },
  padSessionSubmit: { method: 'POST', path: '/api/pad-sessions/:sessionId/submit' },
  padSessionConsume: { method: 'POST', path: '/api/pad-sessions/:sessionId/consume' },
  padSessionSubmissionConsume: {
    method: 'POST',
    path: '/api/pad-sessions/:sessionId/submissions/:submissionId/consume',
  },
  padSessionClose: { method: 'POST', path: '/api/pad-sessions/:sessionId/close' },
  padSessionDisconnect: { method: 'POST', path: '/api/pad-sessions/:sessionId/disconnect' },
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
export const PAD_SECRET_HEADER = 'x-pad-secret';
