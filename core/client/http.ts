import { type z } from 'zod';

import {
  API_ROUTES,
  apiTokenCreateOutputSchema,
  apiTokenListOutputSchema,
  apiTokenRevokeOutputSchema,
  authConfigOutputSchema,
  invitationAcceptOutputSchema,
  invitationCreateOutputSchema,
  invitationListOutputSchema,
  invitationRevokeOutputSchema,
  documentApproveOutputSchema,
  documentCommentCreateOutputSchema,
  documentCommentApproveOutputSchema,
  documentCommentDeleteOutputSchema,
  documentCommentListOutputSchema,
  documentCreateOutputSchema,
  documentTypeCreateOutputSchema,
  documentTypeDeleteOutputSchema,
  documentTypeListOutputSchema,
  documentTypeRenameOutputSchema,
  documentDeleteOutputSchema,
  documentFileDeleteOutputSchema,
  documentFileMoveOutputSchema,
  documentFileOutputSchema,
  documentFileSealOutputSchema,
  documentGetOutputSchema,
  documentListOutputSchema,
  documentMetadataProposalApproveOutputSchema,
  documentMetadataProposalListOutputSchema,
  documentMetadataProposalRejectOutputSchema,
  documentLinkCreateOutputSchema,
  documentLinkApproveOutputSchema,
  documentLinkDeleteOutputSchema,
  documentLinkListOutputSchema,
  documentPurgeOutputSchema,
  documentRequireSignatureOutputSchema,
  documentRestoreOutputSchema,
  documentTrashListOutputSchema,
  documentUnapproveOutputSchema,
  documentWaiveSignatureOutputSchema,
  documentUpdateOutputSchema,
  fileUploadRequestOutputSchema,
  looseEnvelopeSchema,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  meOutputSchema,
  PAD_SECRET_HEADER,
  padSessionActiveOutputSchema,
  padSessionCloseOutputSchema,
  padSessionConsumeOutputSchema,
  padSessionCreateOutputSchema,
  padSessionDocumentOutputSchema,
  padSessionDisconnectOutputSchema,
  padSessionJoinOutputSchema,
  padSessionRequestOutputSchema,
  padSessionShareOutputSchema,
  padSessionStateOutputSchema,
  padSessionSubmissionConsumeOutputSchema,
  padSessionSubmitOutputSchema,
  PUBLIC_API_ROUTES,
  publicTenantDiscoveryOutputSchema,
  publicTenantDiscoveryPath,
  publicTenantProfileOutputSchema,
  publicTenantProfilePath,
  publicInvitationAcceptPath,
  publicInvitationOutputSchema,
  publicInvitationPath,
  savedSearchCreateOutputSchema,
  savedSearchDeleteOutputSchema,
  savedSearchListOutputSchema,
  signatureRecordCreateOutputSchema,
  signatureRecordListOutputSchema,
  sourceUpdateRequestGetOutputSchema,
  sourceUpdateRequestListOutputSchema,
  sourceUpdateRequestOutputSchema,
  tenantSettingsGetOutputSchema,
  tenantSettingsUpdateOutputSchema,
  tenantAccountListOutputSchema,
  userPreferenceGetOutputSchema,
  userPreferenceSetOutputSchema,
  type HttpMethod,
  type ReadMethod,
  type WriteMethod,
} from '#core/contract/index.js';
import {
  err,
  internal,
  ok,
  type AppError,
  type CreateApiToken,
  type AcceptInvitation,
  type CreateInvitation,
  type CreateSavedSearch,
  type CreateDocument,
  type CreateDocumentType,
  type CreateDocumentComment,
  type DocumentListFilter,
  type DocumentMetadataChanges,
  type LinkDocumentsInput,
  type ExportDocuments,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type MoveDocumentFile,
  type RenameDocumentType,
  type PadCurrentDocument,
  type PadSessionMode,
  type PadStrokeSubmission,
  type Result,
  type SetUserPreference,
  type CreateSignatureRecord,
  type CompleteSourceUpdateRequest,
  type CreateSourceUpdateRequest,
  type DecideSourceUpdateRequest,
  type UpdateTenantSettings,
  type UpdateDocument,
} from '#core/domain/index.js';

declare const HTTP_METHOD_BRAND: unique symbol;

/**
 * Phantom read/write tag on a call's result, driven by the contract's HTTP
 * method. Optional and never assigned at runtime (zero cost, no `as`): a plain
 * `Result` is assignable, yet a `'GET'`-tagged result is not assignable to a
 * `'POST'`-tagged one, so `defineQuery`/`defineMutation` can reject mismatches.
 */
type Branded<T, M extends HttpMethod> = T & { readonly [HTTP_METHOD_BRAND]?: M };
export type ReadResult<T> = Branded<Result<T, AppError>, ReadMethod>;
export type WriteResult<T> = Branded<Result<T, AppError>, WriteMethod>;

export interface ApiClientOptions {
  /** '' for same-origin (web); absolute URL for CLI and other clients. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Extra headers per request: Authorization bearer token, X-Tenant, ... */
  headers?: () => Record<string, string>;
  /**
   * W3C `traceparent` for the currently active span, or `undefined` when no
   * trace is active. Injected header-provider (bound in the composition root)
   * rather than an in-core OTel dependency: keeps `core/client` framework- and
   * SDK-free and makes propagation trivially testable by passing a stub.
   */
  traceparent?: () => string | undefined;
}

const request = async <S extends z.ZodTypeAny, M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  outputSchema: S,
  body?: unknown,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<Branded<Result<z.output<S>, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceparent = options.traceparent?.();
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(traceparent === undefined ? {} : { traceparent }),
        ...options.headers?.(),
        ...headers,
      },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: 'include',
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error calling ${path}: ${String(cause)}`));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return err(internal(`Non-JSON response from ${path} (HTTP ${response.status})`));
  }

  const envelope = looseEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return err(internal(`Response from ${path} does not match the contract envelope`));
  }
  if (!envelope.data.ok) return err(envelope.data.error);

  const data = outputSchema.safeParse(envelope.data.data);
  if (!data.success) {
    return err(internal(`Response data from ${path} does not match the contract`));
  }
  return ok(data.data);
};

const pathWith = (path: string, values: Record<string, string>): string => {
  let resolved = path;
  for (const [name, value] of Object.entries(values)) {
    resolved = resolved.replace(`:${name}`, encodeURIComponent(value));
  }
  return resolved;
};

const queryString = (filter: DocumentListFilter): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value);
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
};

const paginationQueryString = (input: {
  cursor?: string | undefined;
  limit?: number | undefined;
}): string => {
  const params = new URLSearchParams();
  if (input.cursor !== undefined) params.set('cursor', input.cursor);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : '';
};

const binaryBody = (bytes: Uint8Array): ArrayBuffer => {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
};

export interface ExportDownload {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

export interface DirectFileUploadInput {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  bytes: Uint8Array;
}

const directFileUpload = async (
  options: ApiClientOptions,
  input: DirectFileUploadInput,
  signal?: AbortSignal,
): Promise<WriteResult<void>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: binaryBody(input.bytes),
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error uploading ${input.url}: ${String(cause)}`));
  }
  return response.ok
    ? ok(undefined)
    : err(internal(`Upload to object storage failed (HTTP ${response.status})`));
};

const download = async <M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Branded<Result<ExportDownload, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceparent = options.traceparent?.();
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(traceparent === undefined ? {} : { traceparent }),
        ...options.headers?.(),
      },
      body: body === undefined ? null : JSON.stringify(body),
      credentials: 'include',
      signal: signal ?? null,
    });
  } catch (cause) {
    return err(internal(`Network error calling ${path}: ${String(cause)}`));
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const envelope = looseEnvelopeSchema.safeParse(payload);
    return envelope.success && !envelope.data.ok
      ? err(envelope.data.error)
      : err(internal(`Non-contract response from ${path} (HTTP ${response.status})`));
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="([^"]+)"/i.exec(disposition)?.[1];
  return ok({
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    fileName: encodedName ? decodeURIComponent(encodedName) : (plainName ?? 'download.bin'),
  });
};

/** The single typed gateway to the API. No client ever hand-writes HTTP. */
export const createApiClient = (options: ApiClientOptions) => ({
  health: (signal?: AbortSignal) =>
    request(options, API_ROUTES.health.method, API_ROUTES.health.path, healthOutputSchema, undefined, signal),
  healthLive: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthLive.method, API_ROUTES.healthLive.path, healthLiveOutputSchema, undefined, signal),
  healthReady: (signal?: AbortSignal) =>
    request(options, API_ROUTES.healthReady.method, API_ROUTES.healthReady.path, healthReadyOutputSchema, undefined, signal),
  config: (signal?: AbortSignal) =>
    request(options, API_ROUTES.config.method, API_ROUTES.config.path, authConfigOutputSchema, undefined, signal),
  me: (signal?: AbortSignal) =>
    request(options, API_ROUTES.me.method, API_ROUTES.me.path, meOutputSchema, undefined, signal),
  listDocuments: (filter: DocumentListFilter = {}, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documents.method,
      `${API_ROUTES.documents.path}${queryString(filter)}`,
      documentListOutputSchema,
      undefined,
      signal,
    ),
  createDocument: (input: CreateDocument, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentsCreate.method,
      API_ROUTES.documentsCreate.path,
      documentCreateOutputSchema,
      input,
      signal,
    ),
  listDocumentTypes: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentTypes.method,
      API_ROUTES.documentTypes.path,
      documentTypeListOutputSchema,
      undefined,
      signal,
    ),
  createDocumentType: (input: CreateDocumentType, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentTypesCreate.method,
      API_ROUTES.documentTypesCreate.path,
      documentTypeCreateOutputSchema,
      input,
      signal,
    ),
  renameDocumentType: (slug: string, input: RenameDocumentType, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentTypeRename.method,
      pathWith(API_ROUTES.documentTypeRename.path, { slug }),
      documentTypeRenameOutputSchema,
      input,
      signal,
    ),
  deleteDocumentType: (slug: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentTypeDelete.method,
      pathWith(API_ROUTES.documentTypeDelete.path, { slug }),
      documentTypeDeleteOutputSchema,
      undefined,
      signal,
    ),
  listTrashedDocuments: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentsTrash.method,
      API_ROUTES.documentsTrash.path,
      documentTrashListOutputSchema,
      undefined,
      signal,
    ),
  getDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.document.method,
      pathWith(API_ROUTES.document.path, { documentId }),
      documentGetOutputSchema,
      undefined,
      signal,
    ),
  listDocumentComments: (
    documentId: string,
    input: { cursor?: string | undefined; limit?: number | undefined } = {},
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentComments.method,
      `${pathWith(API_ROUTES.documentComments.path, { documentId })}${paginationQueryString(input)}`,
      documentCommentListOutputSchema,
      undefined,
      signal,
    ),
  addDocumentComment: (
    documentId: string,
    input: CreateDocumentComment,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentCommentCreate.method,
      pathWith(API_ROUTES.documentCommentCreate.path, { documentId }),
      documentCommentCreateOutputSchema,
      input,
      signal,
    ),
  approveDocumentComment: (commentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentCommentApprove.method,
      pathWith(API_ROUTES.documentCommentApprove.path, { commentId }),
      documentCommentApproveOutputSchema,
      {},
      signal,
    ),
  deleteDocumentComment: (
    documentId: string,
    commentId: string,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentCommentDelete.method,
      pathWith(API_ROUTES.documentCommentDelete.path, { documentId, commentId }),
      documentCommentDeleteOutputSchema,
      undefined,
      signal,
    ),
  listDocumentLinks: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentLinks.method,
      pathWith(API_ROUTES.documentLinks.path, { documentId }),
      documentLinkListOutputSchema,
      undefined,
      signal,
    ),
  linkDocuments: (
    documentId: string,
    input: LinkDocumentsInput,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentLinkCreate.method,
      pathWith(API_ROUTES.documentLinkCreate.path, { documentId }),
      documentLinkCreateOutputSchema,
      input,
      signal,
    ),
  approveDocumentLink: (linkId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentLinkApprove.method,
      pathWith(API_ROUTES.documentLinkApprove.path, { linkId }),
      documentLinkApproveOutputSchema,
      {},
      signal,
    ),
  unlinkDocuments: (
    documentId: string,
    otherDocumentId: string,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentLinkDelete.method,
      pathWith(API_ROUTES.documentLinkDelete.path, { documentId, otherDocumentId }),
      documentLinkDeleteOutputSchema,
      undefined,
      signal,
    ),
  updateDocument: (documentId: string, input: UpdateDocument, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentUpdate.method,
      pathWith(API_ROUTES.documentUpdate.path, { documentId }),
      documentUpdateOutputSchema,
      input,
      signal,
    ),
  proposeDocumentUpdate: (
    documentId: string,
    input: DocumentMetadataChanges,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentUpdate.method,
      pathWith(API_ROUTES.documentUpdate.path, { documentId }),
      documentUpdateOutputSchema,
      input,
      signal,
    ),
  listDocumentMetadataProposals: (
    documentId: string,
    input: { cursor?: string | undefined; limit?: number | undefined } = {},
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentMetadataProposals.method,
      `${pathWith(API_ROUTES.documentMetadataProposals.path, { documentId })}${paginationQueryString(input)}`,
      documentMetadataProposalListOutputSchema,
      undefined,
      signal,
    ),
  approveDocumentMetadataProposal: (proposalId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentMetadataProposalApprove.method,
      pathWith(API_ROUTES.documentMetadataProposalApprove.path, { proposalId }),
      documentMetadataProposalApproveOutputSchema,
      {},
      signal,
    ),
  rejectDocumentMetadataProposal: (proposalId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentMetadataProposalReject.method,
      pathWith(API_ROUTES.documentMetadataProposalReject.path, { proposalId }),
      documentMetadataProposalRejectOutputSchema,
      {},
      signal,
    ),
  approveDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentApprove.method,
      pathWith(API_ROUTES.documentApprove.path, { documentId }),
      documentApproveOutputSchema,
      {},
      signal,
    ),
  unapproveDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentUnapprove.method,
      pathWith(API_ROUTES.documentUnapprove.path, { documentId }),
      documentUnapproveOutputSchema,
      {},
      signal,
    ),
  waiveDocumentSignature: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentWaiveSignature.method,
      pathWith(API_ROUTES.documentWaiveSignature.path, { documentId }),
      documentWaiveSignatureOutputSchema,
      {},
      signal,
    ),
  requireDocumentSignature: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentRequireSignature.method,
      pathWith(API_ROUTES.documentRequireSignature.path, { documentId }),
      documentRequireSignatureOutputSchema,
      {},
      signal,
    ),
  deleteDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentDelete.method,
      pathWith(API_ROUTES.documentDelete.path, { documentId }),
      documentDeleteOutputSchema,
      undefined,
      signal,
    ),
  restoreDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentRestore.method,
      pathWith(API_ROUTES.documentRestore.path, { documentId }),
      documentRestoreOutputSchema,
      undefined,
      signal,
    ),
  purgeDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentPurge.method,
      pathWith(API_ROUTES.documentPurge.path, { documentId }),
      documentPurgeOutputSchema,
      undefined,
      signal,
    ),
  requestFileUpload: (documentId: string, input: FileUploadRequest, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentFileUploadRequest.method,
      pathWith(API_ROUTES.documentFileUploadRequest.path, { documentId }),
      fileUploadRequestOutputSchema,
      input,
      signal,
    ),
  finalizeFileUpload: (documentId: string, input: FinalizeFileUpload, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentFileFinalize.method,
      pathWith(API_ROUTES.documentFileFinalize.path, { documentId }),
      documentFileOutputSchema,
      input,
      signal,
    ),
  uploadDocumentFile: async (
    documentId: string,
    input: FileUploadRequest & { bytes: Uint8Array },
    signal?: AbortSignal,
  ): Promise<WriteResult<z.output<typeof documentFileOutputSchema>>> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const traceparent = options.traceparent?.();
    const contributorQuery = input.contributorAccountIds
      ?.map((accountId) => `&contributorAccountId=${encodeURIComponent(accountId)}`)
      .join('') ?? '';
    const path =
      pathWith(API_ROUTES.documentFileServerUpload.path, { documentId }) +
      `?fileName=${encodeURIComponent(input.fileName)}&role=${encodeURIComponent(input.role)}${contributorQuery}`;
    let response: Response;
    try {
      response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: API_ROUTES.documentFileServerUpload.method,
        headers: {
          'content-type': input.contentType,
          ...(traceparent === undefined ? {} : { traceparent }),
          ...options.headers?.(),
        },
        body: binaryBody(input.bytes),
        credentials: 'include',
        signal: signal ?? null,
      });
    } catch (cause) {
      return err(internal(`Network error calling ${path}: ${String(cause)}`));
    }
    const payload: unknown = await response.json().catch(() => null);
    const envelope = looseEnvelopeSchema.safeParse(payload);
    if (!envelope.success) return err(internal(`Response from ${path} does not match the contract envelope`));
    if (!envelope.data.ok) return err(envelope.data.error);
    const parsed = documentFileOutputSchema.safeParse(envelope.data.data);
    return parsed.success ? ok(parsed.data) : err(internal(`Response data from ${path} does not match the contract`));
  },
  deleteDocumentFile: (documentId: string, fileId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentFileDelete.method,
      pathWith(API_ROUTES.documentFileDelete.path, { documentId, fileId }),
      documentFileDeleteOutputSchema,
      undefined,
      signal,
    ),
  moveDocumentFile: (
    documentId: string,
    fileId: string,
    input: MoveDocumentFile,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentFileMove.method,
      pathWith(API_ROUTES.documentFileMove.path, { documentId, fileId }),
      documentFileMoveOutputSchema,
      input,
      signal,
    ),
  downloadDocumentFile: (documentId: string, fileId: string, signal?: AbortSignal) =>
    download(
      options,
      API_ROUTES.documentFileContent.method,
      pathWith(API_ROUTES.documentFileContent.path, { documentId, fileId }),
      undefined,
      signal,
    ),
  getDocumentFileSealVerification: (
    documentId: string,
    fileId: string,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.documentFileSeal.method,
      pathWith(API_ROUTES.documentFileSeal.path, { documentId, fileId }),
      documentFileSealOutputSchema,
      undefined,
      signal,
    ),
  exportDocumentFile: (documentId: string, fileId: string, signal?: AbortSignal) =>
    download(
      options,
      API_ROUTES.documentFileExport.method,
      pathWith(API_ROUTES.documentFileExport.path, { documentId, fileId }),
      undefined,
      signal,
    ),
  exportDocuments: (input: ExportDocuments, signal?: AbortSignal) =>
    download(
      options,
      API_ROUTES.documentsExport.method,
      API_ROUTES.documentsExport.path,
      input,
      signal,
    ),
  listSavedSearches: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.savedSearches.method,
      API_ROUTES.savedSearches.path,
      savedSearchListOutputSchema,
      undefined,
      signal,
    ),
  createSavedSearch: (input: CreateSavedSearch, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.savedSearchesCreate.method,
      API_ROUTES.savedSearchesCreate.path,
      savedSearchCreateOutputSchema,
      input,
      signal,
    ),
  deleteSavedSearch: (savedSearchId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.savedSearchDelete.method,
      pathWith(API_ROUTES.savedSearchDelete.path, { savedSearchId }),
      savedSearchDeleteOutputSchema,
      undefined,
      signal,
    ),
  createApiToken: (input: CreateApiToken, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiTokensCreate.method,
      API_ROUTES.apiTokensCreate.path,
      apiTokenCreateOutputSchema,
      input,
      signal,
    ),
  listApiTokens: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiTokens.method,
      API_ROUTES.apiTokens.path,
      apiTokenListOutputSchema,
      undefined,
      signal,
    ),
  revokeApiToken: (apiTokenId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.apiTokenRevoke.method,
      pathWith(API_ROUTES.apiTokenRevoke.path, { apiTokenId }),
      apiTokenRevokeOutputSchema,
      {},
      signal,
    ),
  createInvitation: (input: CreateInvitation, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.invitationsCreate.method,
      API_ROUTES.invitationsCreate.path,
      invitationCreateOutputSchema,
      input,
      signal,
    ),
  listInvitations: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.invitations.method,
      API_ROUTES.invitations.path,
      invitationListOutputSchema,
      undefined,
      signal,
    ),
  revokeInvitation: (invitationId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.invitationRevoke.method,
      pathWith(API_ROUTES.invitationRevoke.path, { invitationId }),
      invitationRevokeOutputSchema,
      {},
      signal,
    ),
  getUserPreference: (key: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.userPreference.method,
      pathWith(API_ROUTES.userPreference.path, { key }),
      userPreferenceGetOutputSchema,
      undefined,
      signal,
    ),
  setUserPreference: (key: string, input: SetUserPreference, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.userPreferenceSet.method,
      pathWith(API_ROUTES.userPreferenceSet.path, { key }),
      userPreferenceSetOutputSchema,
      input,
      signal,
    ),
  getTenantSettings: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSettings.method,
      API_ROUTES.tenantSettings.path,
      tenantSettingsGetOutputSchema,
      undefined,
      signal,
    ),
  listTenantAccounts: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantAccounts.method,
      API_ROUTES.tenantAccounts.path,
      tenantAccountListOutputSchema,
      undefined,
      signal,
    ),
  updateTenantSettings: (input: UpdateTenantSettings, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantSettingsUpdate.method,
      API_ROUTES.tenantSettingsUpdate.path,
      tenantSettingsUpdateOutputSchema,
      input,
      signal,
    ),
  listSignatureRecords: (
    documentId: string,
    input: { cursor?: string | undefined; limit?: number | undefined } = {},
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.signatureRecords.method,
      `${pathWith(API_ROUTES.signatureRecords.path, { documentId })}${paginationQueryString(input)}`,
      signatureRecordListOutputSchema,
      undefined,
      signal,
    ),
  createSignatureRecord: (
    documentId: string,
    input: CreateSignatureRecord,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.signatureRecordsCreate.method,
      pathWith(API_ROUTES.signatureRecordsCreate.path, { documentId }),
      signatureRecordCreateOutputSchema,
      input,
      signal,
    ),
  getActiveSourceUpdateRequest: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequest.method,
      pathWith(API_ROUTES.sourceUpdateRequest.path, { documentId }),
      sourceUpdateRequestGetOutputSchema,
      undefined,
      signal,
    ),
  listPendingSourceUpdateRequests: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequestsPending.method,
      API_ROUTES.sourceUpdateRequestsPending.path,
      sourceUpdateRequestListOutputSchema,
      undefined,
      signal,
    ),
  createSourceUpdateRequest: (
    documentId: string,
    input: CreateSourceUpdateRequest,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequestsCreate.method,
      pathWith(API_ROUTES.sourceUpdateRequestsCreate.path, { documentId }),
      sourceUpdateRequestOutputSchema,
      input,
      signal,
    ),
  decideSourceUpdateRequest: (
    requestId: string,
    input: DecideSourceUpdateRequest,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequestDecision.method,
      pathWith(API_ROUTES.sourceUpdateRequestDecision.path, { requestId }),
      sourceUpdateRequestOutputSchema,
      input,
      signal,
    ),
  cancelSourceUpdateRequest: (requestId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequestCancel.method,
      pathWith(API_ROUTES.sourceUpdateRequestCancel.path, { requestId }),
      sourceUpdateRequestOutputSchema,
      {},
      signal,
    ),
  completeSourceUpdateRequest: (
    requestId: string,
    input: CompleteSourceUpdateRequest,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.sourceUpdateRequestComplete.method,
      pathWith(API_ROUTES.sourceUpdateRequestComplete.path, { requestId }),
      sourceUpdateRequestOutputSchema,
      input,
      signal,
    ),
  createPadSession: (mode: PadSessionMode = 'private', signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionsCreate.method,
      API_ROUTES.padSessionsCreate.path,
      padSessionCreateOutputSchema,
      { mode },
      signal,
    ),
  getActivePadSession: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionActive.method,
      API_ROUTES.padSessionActive.path,
      padSessionActiveOutputSchema,
      undefined,
      signal,
    ),
  joinOwnPadSession: (signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionJoin.method,
      API_ROUTES.padSessionJoin.path,
      padSessionJoinOutputSchema,
      {},
      signal,
    ),
  sharePadSession: (sessionId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionShare.method,
      pathWith(API_ROUTES.padSessionShare.path, { sessionId }),
      padSessionShareOutputSchema,
      {},
      signal,
    ),
  getPadState: (sessionId: string, secret: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionState.method,
      pathWith(API_ROUTES.padSessionState.path, { sessionId }),
      padSessionStateOutputSchema,
      undefined,
      signal,
      secret ? { [PAD_SECRET_HEADER]: secret } : undefined,
    ),
  requestPadSignature: (
    sessionId: string,
    input: { documentTitle: string },
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.padSessionRequest.method,
      pathWith(API_ROUTES.padSessionRequest.path, { sessionId }),
      padSessionRequestOutputSchema,
      input,
      signal,
    ),
  setPadCurrentDocument: (
    sessionId: string,
    document: PadCurrentDocument,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.padSessionDocument.method,
      pathWith(API_ROUTES.padSessionDocument.path, { sessionId }),
      padSessionDocumentOutputSchema,
      { document },
      signal,
    ),
  submitPadStrokes: (
    sessionId: string,
    secret: string,
    input: PadStrokeSubmission,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.padSessionSubmit.method,
      pathWith(API_ROUTES.padSessionSubmit.path, { sessionId }),
      padSessionSubmitOutputSchema,
      input,
      signal,
      secret ? { [PAD_SECRET_HEADER]: secret } : undefined,
    ),
  consumePadStrokes: (sessionId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionConsume.method,
      pathWith(API_ROUTES.padSessionConsume.path, { sessionId }),
      padSessionConsumeOutputSchema,
      {},
      signal,
    ),
  consumePadSubmission: (
    sessionId: string,
    submissionId: string,
    signal?: AbortSignal,
  ) =>
    request(
      options,
      API_ROUTES.padSessionSubmissionConsume.method,
      pathWith(API_ROUTES.padSessionSubmissionConsume.path, { sessionId, submissionId }),
      padSessionSubmissionConsumeOutputSchema,
      {},
      signal,
    ),
  closePadSession: (sessionId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionClose.method,
      pathWith(API_ROUTES.padSessionClose.path, { sessionId }),
      padSessionCloseOutputSchema,
      {},
      signal,
    ),
  disconnectPadSession: (sessionId: string, secret: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.padSessionDisconnect.method,
      pathWith(API_ROUTES.padSessionDisconnect.path, { sessionId }),
      padSessionDisconnectOutputSchema,
      {},
      signal,
      secret ? { [PAD_SECRET_HEADER]: secret } : undefined,
    ),
  documentFileContentUrl: (documentId: string, fileId: string) =>
    `${options.baseUrl}${pathWith(API_ROUTES.documentFileContent.path, { documentId, fileId })}`,
  documentFileExportUrl: (documentId: string, fileId: string) =>
    `${options.baseUrl}${pathWith(API_ROUTES.documentFileExport.path, { documentId, fileId })}`,
  directFileUpload: (input: DirectFileUploadInput, signal?: AbortSignal) =>
    directFileUpload(options, input, signal),
  publicTenantDiscovery: (slug: string, signal?: AbortSignal) =>
    request(
      options,
      PUBLIC_API_ROUTES.tenantDiscovery.method,
      publicTenantDiscoveryPath(slug),
      publicTenantDiscoveryOutputSchema,
      undefined,
      signal,
    ),
  publicTenantProfile: (slug: string, version: string, signal?: AbortSignal) =>
    request(
      options,
      PUBLIC_API_ROUTES.tenantProfile.method,
      publicTenantProfilePath(slug, version),
      publicTenantProfileOutputSchema,
      undefined,
      signal,
    ),
  publicInvitation: (token: string, signal?: AbortSignal) =>
    request(
      options,
      PUBLIC_API_ROUTES.invitation.method,
      publicInvitationPath(token),
      publicInvitationOutputSchema,
      undefined,
      signal,
    ),
  acceptInvitation: (token: string, input: AcceptInvitation, signal?: AbortSignal) =>
    request(
      options,
      PUBLIC_API_ROUTES.invitationAccept.method,
      publicInvitationAcceptPath(token),
      invitationAcceptOutputSchema,
      input,
      signal,
    ),
});

export type ApiClient = ReturnType<typeof createApiClient>;

/** For TanStack Query: converts a Result into value-or-throw at the query boundary. */
export const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
};

export class ApiError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'ApiError';
    this.appError = appError;
  }
}
