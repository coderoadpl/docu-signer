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

import type {
  CreateApiToken,
  CreateSavedSearch,
  CreateDocument,
  DocumentListFilter,
  ExportDocuments,
  FileUploadRequest,
  FinalizeFileUpload,
  MoveDocumentFile,
  SetUserPreference,
  UpdateDocument,
} from '#core/domain/index.js';

import type {
  AuthClientPort,
  AuthSessionResult,
  ChangePasswordInput,
  MagicLinkRequest,
  PasswordResetCompletion,
  PasswordResetRequest,
  SocialSignInInput,
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

const savedSearchScopes = {
  all: () => ['saved-searches'] as const,
  lists: () => ['saved-searches', 'list'] as const,
};

const apiTokenScopes = {
  all: () => ['api-tokens'] as const,
  lists: () => ['api-tokens', 'list'] as const,
};

const userPreferenceScopes = {
  all: () => ['user-preferences'] as const,
  detail: (key: string) => ['user-preferences', key] as const,
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

export const approveDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'approve'],
    call: (documentId: string) => api.approveDocument(documentId),
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
