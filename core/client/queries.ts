import type {
  DefaultError,
  FetchQueryOptions,
  MutationFunction,
  MutationKey,
  MutationOptions,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
} from '@tanstack/query-core';

import {
  MAX_PAGE_LIMIT,
  ok,
  type CompleteSourceUpdateRequest,
  type AcceptInvitation,
  type CreateApiToken,
  type CreateDocument,
  type CreateDocumentType,
  type CreateDocumentComment,
  type CreateInvitation,
  type CreateSavedSearch,
  type CreateSignatureRecord,
  type CreateSourceUpdateRequest,
  type DecideSourceUpdateRequest,
  type DocumentListFilter,
  type DocumentCommentListItem,
  type LinkDocumentsInput,
  type ExportDocuments,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type MoveDocumentFile,
  type RenameDocumentType,
  type PadCurrentDocument,
  type PadSessionMode,
  type PadStrokeSubmission,
  type SetUserPreference,
  type UpdateDocument,
  type UpdateTenantSettings,
} from '#core/domain/index.js';
import type { SignatureRecordListItem } from '#core/contract/index.js';

import type {
  AuthClientPort,
  AuthSessionResult,
  ChangePasswordInput,
  MagicLinkRequest,
  PasswordResetCompletion,
  PasswordResetRequest,
  SocialSignInInput,
  UpdateUserInput,
} from './auth-port.js';
import {
  unwrap,
  type ApiClient,
  type DirectFileUploadInput,
  type ReadResult,
  type WriteResult,
} from './http.js';

/**
 * Identity helpers that type descriptors against `@tanstack/query-core` option
 * types (never `@tanstack/react-query`, which `core/client` may not import).
 * They bind the `queryFn` result type to the key so `useQuery`/`useMutation`
 * infer `data`/`variables` at the call site without explicit generics.
 *
 * CQRS partition is enforced here: `defineQuery` accepts only a read-tagged
 * `call` (a GET contract route), `defineMutation` only a write-tagged one.
 * Each helper owns the `unwrap` so the tag never leaks into `data`/`variables`.
 */
export type QueryDescriptor<TQueryFnData, TQueryKey extends QueryKey> = FetchQueryOptions<
  TQueryFnData,
  DefaultError,
  TQueryFnData,
  TQueryKey
> & { queryFn: QueryFunction<TQueryFnData, TQueryKey> };

type ReadCall<TQueryFnData, TQueryKey extends QueryKey> = (
  context: QueryFunctionContext<TQueryKey>,
) => Promise<ReadResult<TQueryFnData>>;

type DefineQueryInput<TQueryFnData, TQueryKey extends QueryKey> = Omit<
  QueryDescriptor<TQueryFnData, TQueryKey>,
  'queryFn'
> & { call: ReadCall<TQueryFnData, TQueryKey> };

const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
  input: DefineQueryInput<TQueryFnData, TQueryKey>,
): QueryDescriptor<TQueryFnData, TQueryKey> => {
  const { call, ...rest } = input;
  return { ...rest, queryFn: async (context) => unwrap(await call(context)) };
};

export type MutationDescriptor<TData, TVariables> = MutationOptions<
  TData,
  DefaultError,
  TVariables
> & { mutationKey: MutationKey; mutationFn: MutationFunction<TData, TVariables> };

type WriteCall<TData, TVariables> = (variables: TVariables) => Promise<WriteResult<TData>>;

type DefineMutationInput<TData, TVariables> = Omit<
  MutationDescriptor<TData, TVariables>,
  'mutationFn'
> & { call: WriteCall<TData, TVariables> };

const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

/**
 * Query keys are the public API of each resource: general → specific, matched
 * by prefix for invalidation and per-prefix defaults. Never hand-copy a key.
 */
const meScopes = {
  all: () => ['me'] as const,
};

export const meInvalidates = () => ({ queryKey: meScopes.all() });

const documentsScopes = {
  all: () => ['documents'] as const,
  lists: () => ['documents', 'list'] as const,
  list: (filter: DocumentListFilter) => ['documents', 'list', filter] as const,
  trash: () => ['documents', 'trash'] as const,
  details: () => ['documents', 'detail'] as const,
  detail: (documentId: string) => ['documents', 'detail', documentId] as const,
  file: (documentId: string, fileId: string) =>
    ['documents', 'detail', documentId, 'file', fileId] as const,
};

const documentTypeScopes = {
  all: () => ['document-types'] as const,
  lists: () => ['document-types', 'list'] as const,
};

const documentLinksScopes = {
  all: () => ['document-links'] as const,
  document: (documentId: string) => ['document-links', documentId] as const,
};

const documentCommentScopes = {
  all: () => ['document-comments'] as const,
  document: (documentId: string) => ['document-comments', documentId] as const,
};

export const documentLinksInvalidates = () => ({ queryKey: documentLinksScopes.all() });

const savedSearchScopes = {
  all: () => ['saved-searches'] as const,
  lists: () => ['saved-searches', 'list'] as const,
};

const apiTokenScopes = {
  all: () => ['api-tokens'] as const,
  lists: () => ['api-tokens', 'list'] as const,
};

const invitationScopes = {
  all: () => ['invitations'] as const,
  lists: () => ['invitations', 'list'] as const,
  public: (token: string) => ['invitations', 'public', token] as const,
};

const userPreferenceScopes = {
  all: () => ['user-preferences'] as const,
  detail: (key: string) => ['user-preferences', key] as const,
};

const tenantSettingsScopes = {
  all: () => ['tenant-settings'] as const,
};

const tenantAccountScopes = {
  all: () => ['tenant-accounts'] as const,
};

const signatureRecordScopes = {
  all: () => ['signature-records'] as const,
  document: (documentId: string) => ['signature-records', documentId] as const,
};

const sourceUpdateRequestScopes = {
  all: () => ['source-update-requests'] as const,
  pending: () => ['source-update-requests', 'pending'] as const,
  document: (documentId: string) =>
    ['source-update-requests', 'document', documentId] as const,
};

const padSessionScopes = {
  all: () => ['pad-sessions'] as const,
  active: () => ['pad-sessions', 'active'] as const,
  detail: (sessionId: string) => ['pad-sessions', sessionId] as const,
  state: (sessionId: string) => ['pad-sessions', sessionId, 'state'] as const,
};

const authScopes = {
  all: () => ['auth'] as const,
};

const passkeysScopes = {
  all: () => ['passkeys'] as const,
};

/** Register/remove change the roster, so both invalidate the passkey list scope. */
export const passkeysInvalidates = () => ({ queryKey: passkeysScopes.all() });

const configScopes = {
  all: () => ['config'] as const,
};

export const configQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: configScopes.all(),
    call: ({ signal }) => api.config(signal),
  });

export const meQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: meScopes.all(),
    call: ({ signal }) => api.me(signal),
  });

export const documentsQuery = (api: ApiClient, filter: DocumentListFilter = {}) =>
  defineQuery({
    queryKey: documentsScopes.list(filter),
    call: ({ signal }) => api.listDocuments(filter, signal),
  });

export const documentTypesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: documentTypeScopes.lists(),
    call: ({ signal }) => api.listDocumentTypes(signal),
  });

export const createDocumentTypeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentTypeScopes.all(), 'create'],
    call: (input: CreateDocumentType) => api.createDocumentType(input),
  });

export const renameDocumentTypeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentTypeScopes.all(), 'rename'],
    call: ({ slug, input }: { slug: string; input: RenameDocumentType }) =>
      api.renameDocumentType(slug, input),
  });

export const deleteDocumentTypeMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentTypeScopes.all(), 'delete'],
    call: (slug: string) => api.deleteDocumentType(slug),
  });

export const documentTypesInvalidates = (): Array<{ queryKey: readonly unknown[] }> => [
  { queryKey: documentTypeScopes.all() },
  { queryKey: documentsScopes.all() },
  { queryKey: savedSearchScopes.all() },
];

export const trashedDocumentsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: documentsScopes.trash(),
    call: ({ signal }) => api.listTrashedDocuments(signal),
  });

export const documentQuery = (api: ApiClient, documentId: string) =>
  defineQuery({
    queryKey: documentsScopes.detail(documentId),
    call: ({ signal }) => api.getDocument(documentId, signal),
  });

export const documentLinksQuery = (api: ApiClient, documentId: string) =>
  defineQuery({
    queryKey: documentLinksScopes.document(documentId),
    call: ({ signal }) => api.listDocumentLinks(documentId, signal),
  });

const listAllDocumentComments = async (
  api: ApiClient,
  documentId: string,
  signal: AbortSignal,
) => {
  const items: DocumentCommentListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listDocumentComments(
      documentId,
      {
        limit: MAX_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    );
    if (!page.ok) return page;
    items.push(...page.value.items);
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok({ items, nextCursor: null });
};

export const documentCommentsQuery = (api: ApiClient, documentId: string) =>
  defineQuery({
    queryKey: documentCommentScopes.document(documentId),
    call: ({ signal }) => listAllDocumentComments(api, documentId, signal),
  });

export const addDocumentCommentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentCommentScopes.all(), 'create'],
    call: ({ documentId, input }: { documentId: string; input: CreateDocumentComment }) =>
      api.addDocumentComment(documentId, input),
  });

export const deleteDocumentCommentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentCommentScopes.all(), 'delete'],
    call: ({ documentId, commentId }: { documentId: string; commentId: string }) =>
      api.deleteDocumentComment(documentId, commentId),
  });

export const documentCommentsInvalidates = (documentId: string) => ({
  queryKey: documentCommentScopes.document(documentId),
});

export const documentFileQuery = (
  api: ApiClient,
  documentId: string,
  fileId: string,
) =>
  defineQuery({
    queryKey: documentsScopes.file(documentId, fileId),
    call: ({ signal }) => api.downloadDocumentFile(documentId, fileId, signal),
  });

export const createDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'create'],
    call: (input: CreateDocument) => api.createDocument(input),
  });

export const updateDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'update'],
    call: ({ documentId, input }: { documentId: string; input: UpdateDocument }) =>
      api.updateDocument(documentId, input),
  });

export const linkDocumentsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentLinksScopes.all(), 'create'],
    call: ({
      documentId,
      input,
    }: {
      documentId: string;
      input: LinkDocumentsInput;
    }) => api.linkDocuments(documentId, input),
  });

export const unlinkDocumentsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentLinksScopes.all(), 'delete'],
    call: ({ documentId, otherDocumentId }: { documentId: string; otherDocumentId: string }) =>
      api.unlinkDocuments(documentId, otherDocumentId),
  });

export const approveDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'approve'],
    call: (documentId: string) => api.approveDocument(documentId),
  });

export const unapproveDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'unapprove'],
    call: (documentId: string) => api.unapproveDocument(documentId),
  });

export const waiveDocumentSignatureMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'waive-signature'],
    call: (documentId: string) => api.waiveDocumentSignature(documentId),
  });

export const requireDocumentSignatureMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'require-signature'],
    call: (documentId: string) => api.requireDocumentSignature(documentId),
  });

export const deleteDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'delete'],
    call: (documentId: string) => api.deleteDocument(documentId),
  });

export const restoreDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'restore'],
    call: (documentId: string) => api.restoreDocument(documentId),
  });

export const purgeDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'purge'],
    call: (documentId: string) => api.purgeDocument(documentId),
  });

export const requestFileUploadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'request-upload'],
    call: ({ documentId, input }: { documentId: string; input: FileUploadRequest }) =>
      api.requestFileUpload(documentId, input),
  });

export const finalizeFileUploadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'finalize'],
    call: ({ documentId, input }: { documentId: string; input: FinalizeFileUpload }) =>
      api.finalizeFileUpload(documentId, input),
  });

export const uploadDocumentFileMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'server-upload'],
    call: ({
      documentId,
      input,
    }: {
      documentId: string;
      input: FileUploadRequest & { bytes: Uint8Array };
    }) => api.uploadDocumentFile(documentId, input),
  });

export const directFileUploadMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'direct-upload'],
    call: (input: DirectFileUploadInput) => api.directFileUpload(input),
  });

export const deleteDocumentFileMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'delete'],
    call: ({ documentId, fileId }: { documentId: string; fileId: string }) =>
      api.deleteDocumentFile(documentId, fileId),
  });

export const moveDocumentFileMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'files', 'move'],
    call: ({
      documentId,
      fileId,
      input,
    }: {
      documentId: string;
      fileId: string;
      input: MoveDocumentFile;
    }) => api.moveDocumentFile(documentId, fileId, input),
  });

export const exportDocumentsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'export'],
    call: (input: ExportDocuments) => api.exportDocuments(input),
  });

export const documentsInvalidates = () => ({ queryKey: documentsScopes.all() });

export const savedSearchesQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: savedSearchScopes.lists(),
    call: ({ signal }) => api.listSavedSearches(signal),
  });

export const createSavedSearchMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...savedSearchScopes.all(), 'create'],
    call: (input: CreateSavedSearch) => api.createSavedSearch(input),
  });

export const deleteSavedSearchMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...savedSearchScopes.all(), 'delete'],
    call: (savedSearchId: string) => api.deleteSavedSearch(savedSearchId),
  });

export const savedSearchesInvalidates = () => ({ queryKey: savedSearchScopes.all() });

export const apiTokensQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: apiTokenScopes.lists(),
    call: ({ signal }) => api.listApiTokens(signal),
  });

export const createApiTokenMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiTokenScopes.all(), 'create'],
    call: (input: CreateApiToken) => api.createApiToken(input),
  });

export const revokeApiTokenMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...apiTokenScopes.all(), 'revoke'],
    call: (apiTokenId: string) => api.revokeApiToken(apiTokenId),
  });

export const apiTokensInvalidates = () => ({ queryKey: apiTokenScopes.all() });

export const invitationsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: invitationScopes.lists(),
    call: ({ signal }) => api.listInvitations(signal),
  });

export const createInvitationMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...invitationScopes.all(), 'create'],
    call: (input: CreateInvitation) => api.createInvitation(input),
  });

export const revokeInvitationMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...invitationScopes.all(), 'revoke'],
    call: (invitationId: string) => api.revokeInvitation(invitationId),
  });

export const publicInvitationQuery = (api: ApiClient, token: string) =>
  defineQuery({
    queryKey: invitationScopes.public(token),
    call: ({ signal }) => api.publicInvitation(token, signal),
    retry: false,
  });

export const acceptInvitationMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...invitationScopes.all(), 'accept'],
    call: ({ token, input }: { token: string; input: AcceptInvitation }) =>
      api.acceptInvitation(token, input),
  });

export const invitationsInvalidates = () => ({ queryKey: invitationScopes.all() });

export const userPreferenceQuery = (api: ApiClient, key: string) =>
  defineQuery({
    queryKey: userPreferenceScopes.detail(key),
    call: ({ signal }) => api.getUserPreference(key, signal),
  });

export const setUserPreferenceMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...userPreferenceScopes.all(), 'set'],
    call: ({ key, input }: { key: string; input: SetUserPreference }) =>
      api.setUserPreference(key, input),
  });

export const userPreferenceInvalidates = (key: string) => ({
  queryKey: userPreferenceScopes.detail(key),
});

export const tenantSettingsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantSettingsScopes.all(),
    call: ({ signal }) => api.getTenantSettings(signal),
  });

export const tenantAccountsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantAccountScopes.all(),
    call: ({ signal }) => api.listTenantAccounts(signal),
  });

export const updateTenantSettingsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantSettingsScopes.all(), 'update'],
    call: (input: UpdateTenantSettings) => api.updateTenantSettings(input),
  });

export const tenantSettingsInvalidates = () => ({
  queryKey: tenantSettingsScopes.all(),
});

const listAllSignatureRecords = async (
  api: ApiClient,
  documentId: string,
  signal: AbortSignal,
) => {
  const items: SignatureRecordListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listSignatureRecords(
      documentId,
      {
        limit: MAX_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    );
    if (!page.ok) return page;
    items.push(...page.value.items);
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return ok({ items, nextCursor: null });
};

export const signatureRecordsQuery = (api: ApiClient, documentId: string) =>
  defineQuery({
    queryKey: signatureRecordScopes.document(documentId),
    call: ({ signal }) => listAllSignatureRecords(api, documentId, signal),
  });

export const createSignatureRecordMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...signatureRecordScopes.all(), 'create'],
    call: ({ documentId, input }: { documentId: string; input: CreateSignatureRecord }) =>
      api.createSignatureRecord(documentId, input),
  });

export const signatureRecordsInvalidates = (documentId: string) => ({
  queryKey: signatureRecordScopes.document(documentId),
});

export const activeSourceUpdateRequestQuery = (
  api: ApiClient,
  documentId: string,
) =>
  defineQuery({
    queryKey: sourceUpdateRequestScopes.document(documentId),
    call: ({ signal }) => api.getActiveSourceUpdateRequest(documentId, signal),
  });

export const pendingSourceUpdateRequestsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: sourceUpdateRequestScopes.pending(),
    call: ({ signal }) => api.listPendingSourceUpdateRequests(signal),
  });

export const createSourceUpdateRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...sourceUpdateRequestScopes.all(), 'create'],
    call: ({
      documentId,
      input,
    }: {
      documentId: string;
      input: CreateSourceUpdateRequest;
    }) => api.createSourceUpdateRequest(documentId, input),
  });

export const decideSourceUpdateRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...sourceUpdateRequestScopes.all(), 'decide'],
    call: ({
      requestId,
      input,
    }: {
      requestId: string;
      input: DecideSourceUpdateRequest;
    }) => api.decideSourceUpdateRequest(requestId, input),
  });

export const cancelSourceUpdateRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...sourceUpdateRequestScopes.all(), 'cancel'],
    call: (requestId: string) => api.cancelSourceUpdateRequest(requestId),
  });

export const completeSourceUpdateRequestMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...sourceUpdateRequestScopes.all(), 'complete'],
    call: ({
      requestId,
      input,
    }: {
      requestId: string;
      input: CompleteSourceUpdateRequest;
    }) => api.completeSourceUpdateRequest(requestId, input),
  });

export const sourceUpdateRequestsInvalidates = () => ({
  queryKey: sourceUpdateRequestScopes.all(),
});

export const createPadSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'create'],
    call: (mode: PadSessionMode | undefined) => api.createPadSession(mode),
  });

export const activePadSessionQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: padSessionScopes.active(),
    call: ({ signal }) => api.getActivePadSession(signal),
  });

export const activePadSessionInvalidates = () => ({
  queryKey: padSessionScopes.active(),
});

export const joinOwnPadSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'join'],
    call: () => api.joinOwnPadSession(),
  });

export const sharePadSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'share'],
    call: (sessionId: string) => api.sharePadSession(sessionId),
  });

export const padSessionStateQuery = (
  api: ApiClient,
  sessionId: string,
  secret: string,
) =>
  defineQuery({
    queryKey: padSessionScopes.state(sessionId),
    call: ({ signal }) => api.getPadState(sessionId, secret, signal),
  });

export const requestPadSignatureMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'request'],
    call: ({ sessionId, input }: { sessionId: string; input: { documentTitle: string } }) =>
      api.requestPadSignature(sessionId, input),
  });

export const setPadCurrentDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'document'],
    call: ({
      document,
      sessionId,
    }: {
      document: PadCurrentDocument;
      sessionId: string;
    }) => api.setPadCurrentDocument(sessionId, document),
  });

export const submitPadStrokesMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'submit'],
    call: ({
      input,
      secret,
      sessionId,
    }: {
      input: PadStrokeSubmission;
      secret: string;
      sessionId: string;
    }) => api.submitPadStrokes(sessionId, secret, input),
  });

export const consumePadStrokesMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'consume'],
    call: (sessionId: string) => api.consumePadStrokes(sessionId),
  });

export const consumePadSubmissionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'submission', 'consume'],
    call: ({ sessionId, submissionId }: { sessionId: string; submissionId: string }) =>
      api.consumePadSubmission(sessionId, submissionId),
  });

export const closePadSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'close'],
    call: (sessionId: string) => api.closePadSession(sessionId),
  });

export const disconnectPadSessionMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...padSessionScopes.all(), 'disconnect'],
    call: ({ sessionId, secret }: { sessionId: string; secret: string }) =>
      api.disconnectPadSession(sessionId, secret),
  });

export const padSessionInvalidates = (sessionId: string) => ({
  queryKey: padSessionScopes.detail(sessionId),
});

/**
 * Auth side effects are mutation descriptors over `AuthClientPort` like any
 * other action — never hand-rolled pending/error state around a port call.
 */
export const signUpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-up'],
    call: (input: { name: string; email: string; password: string }) => auth.signUp(input),
  });

export const signInMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-in'],
    call: (input: { email: string; password: string }) => auth.signIn(input),
  });

export const signOutMutation = (auth: AuthClientPort): MutationDescriptor<void, void> =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'sign-out'],
    call: () => auth.signOut(),
  });

export const updateUserMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'update-user'],
    call: (input: UpdateUserInput) => auth.updateUser(input),
  });

export const changePasswordMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'change-password'],
    call: (input: ChangePasswordInput) => auth.changePassword(input),
  });

export const requestMagicLinkMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'magic-link'],
    call: (input: MagicLinkRequest) => auth.requestMagicLink(input),
  });

export const requestPasswordResetMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'password-reset', 'request'],
    call: (input: PasswordResetRequest) => auth.requestPasswordReset(input),
  });

export const resetPasswordMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'password-reset', 'complete'],
    call: (input: PasswordResetCompletion) => auth.resetPassword(input),
  });

export const signInSocialMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'social'],
    call: (input: SocialSignInInput) => auth.signInSocial(input),
  });

export const enableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'two-factor', 'enable'],
    call: (input: { password: string }) => auth.enableTwoFactor(input),
  });

export const verifyTotpMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'two-factor', 'verify'],
    call: (input: { code: string }) => auth.verifyTotp(input),
  });

export const disableTwoFactorMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'two-factor', 'disable'],
    call: (input: { password: string }) => auth.disableTwoFactor(input),
  });

/** US-028a passkeys: the roster is a read; register/remove/sign-in are commands. */
export const passkeysQuery = (auth: AuthClientPort) =>
  defineQuery({
    queryKey: passkeysScopes.all(),
    call: () => auth.listPasskeys(),
  });

export const registerPasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...passkeysScopes.all(), 'register'],
    call: (input: { name: string }) => auth.registerPasskey(input),
  });

export const removePasskeyMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...passkeysScopes.all(), 'remove'],
    call: (input: { id: string }) => auth.removePasskey(input),
  });

export const signInPasskeyMutation = (auth: AuthClientPort): MutationDescriptor<AuthSessionResult, void> =>
  defineMutation({
    mutationKey: [...passkeysScopes.all(), 'sign-in'],
    call: () => auth.signInPasskey(),
  });
