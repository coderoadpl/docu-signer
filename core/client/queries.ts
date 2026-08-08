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
  DomainAddInput,
  DomainCheckInput,
  DomainRemoveInput,
  MemberEnsureInput,
  StaffGrantInput,
  StaffRevokeInput,
  TenantCreateInput,
} from '#core/contract/index.js';
import type {
  BoardId,
  CardMove,
  CreateDocument,
  DocumentListFilter,
  ExportDocuments,
  FileUploadRequest,
  FinalizeFileUpload,
  NewCard,
  NewTodo,
  UpdateDocument,
} from '#core/domain/index.js';

import type { AuthClientPort, AuthSessionResult, MagicLinkRequest, SocialSignInInput } from './auth-port.js';
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

export const defineQuery = <TQueryFnData, TQueryKey extends QueryKey>(
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

export const defineMutation = <TData, TVariables>(
  input: DefineMutationInput<TData, TVariables>,
): MutationDescriptor<TData, TVariables> => {
  const { call, ...rest } = input;
  return { ...rest, mutationFn: async (variables) => unwrap(await call(variables)) };
};

/**
 * Query keys are the public API of each resource: general → specific, matched
 * by prefix for invalidation and per-prefix defaults. Never hand-copy a key.
 */
export const meScopes = {
  all: () => ['me'] as const,
};

export const tenantsScopes = {
  all: () => ['tenants'] as const,
};

/** Invalidation filters (constructed here, never inline in apps/web). */
export const tenantsInvalidates = () => ({ queryKey: tenantsScopes.all() });
export const meInvalidates = () => ({ queryKey: meScopes.all() });

export const todosScopes = {
  all: () => ['todos'] as const,
  lists: () => ['todos', 'list'] as const,
};

export const documentsScopes = {
  all: () => ['documents'] as const,
  lists: () => ['documents', 'list'] as const,
  list: (filter: DocumentListFilter) => ['documents', 'list', filter] as const,
  details: () => ['documents', 'detail'] as const,
  detail: (documentId: string) => ['documents', 'detail', documentId] as const,
};

export const cardsScopes = {
  all: () => ['cards'] as const,
  lists: () => ['cards', 'list'] as const,
  /** One board's list — a distinct cache entry so personal and team never mix. */
  list: (board: BoardId) => ['cards', 'list', board] as const,
};

export const membersScopes = {
  all: () => ['members'] as const,
  lists: () => ['members', 'list'] as const,
};

export const staffScopes = {
  all: () => ['staff'] as const,
  lists: () => ['staff', 'list'] as const,
};

export const domainsScopes = {
  all: () => ['domains'] as const,
  lists: () => ['domains', 'list'] as const,
};

export const authScopes = {
  all: () => ['auth'] as const,
};

export const passkeysScopes = {
  all: () => ['passkeys'] as const,
};

/** Register/remove change the roster, so both invalidate the passkey list scope. */
export const passkeysInvalidates = () => ({ queryKey: passkeysScopes.all() });

export const configScopes = {
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

export const tenantsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: tenantsScopes.all(),
    call: ({ signal }) => api.listTenants(signal),
  });

export const createTenantMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...tenantsScopes.all(), 'create'],
    call: (input: TenantCreateInput) => api.createTenant(input),
  });

export const todosQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: todosScopes.lists(),
    call: ({ signal }) => api.listTodos(signal),
  });

export const addTodoMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...todosScopes.all(), 'create'],
    call: (input: NewTodo) => api.addTodo(input),
  });

/** The invalidation filter `addTodoMutation` applies after it settles. */
export const addTodoInvalidates = () => ({ queryKey: todosScopes.lists() });

export const documentsQuery = (api: ApiClient, filter: DocumentListFilter = {}) =>
  defineQuery({
    queryKey: documentsScopes.list(filter),
    call: ({ signal }) => api.listDocuments(filter, signal),
  });

export const documentQuery = (api: ApiClient, documentId: string) =>
  defineQuery({
    queryKey: documentsScopes.detail(documentId),
    call: ({ signal }) => api.getDocument(documentId, signal),
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

export const deleteDocumentMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'delete'],
    call: (documentId: string) => api.deleteDocument(documentId),
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

export const exportDocumentsMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...documentsScopes.all(), 'export'],
    call: (input: ExportDocuments) => api.exportDocuments(input),
  });

export const documentsInvalidates = () => ({ queryKey: documentsScopes.all() });

export const cardsQuery = (api: ApiClient, board: BoardId = 'personal') =>
  defineQuery({
    queryKey: cardsScopes.list(board),
    call: ({ signal }) => api.listCards(board, signal),
  });

export const addCardMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...cardsScopes.all(), 'create'],
    call: (input: NewCard) => api.addCard(input),
  });

export const moveCardMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...cardsScopes.all(), 'move'],
    call: (input: CardMove) => api.moveCard(input),
  });

/** Both card writes reorder the board, so both invalidate the list scope. */
export const cardsInvalidates = () => ({ queryKey: cardsScopes.lists() });

export const membersQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: membersScopes.lists(),
    call: async ({ signal }) => {
      const members = [];
      let cursor: string | undefined;
      while (true) {
        const page = await api.listMembers(cursor === undefined ? {} : { cursor }, signal);
        if (!page.ok) return page;
        members.push(...page.value.items);
        if (page.value.nextCursor === null) {
          return {
            ok: true,
            value: { items: members, members, nextCursor: null },
          };
        }
        cursor = page.value.nextCursor;
      }
    },
  });

export const ensureMemberMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...membersScopes.all(), 'ensure'],
    call: (input: MemberEnsureInput) => api.ensureMember(input),
  });

/** The invalidation filter `ensureMemberMutation` applies after it settles. */
export const ensureMemberInvalidates = () => ({ queryKey: membersScopes.lists() });

export const staffQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: staffScopes.lists(),
    call: async ({ signal }) => {
      const staff = [];
      let cursor: string | undefined;
      while (true) {
        const page = await api.listStaff(cursor === undefined ? {} : { cursor }, signal);
        if (!page.ok) return page;
        staff.push(...page.value.items);
        if (page.value.nextCursor === null) {
          return {
            ok: true,
            value: { items: staff, staff, nextCursor: null },
          };
        }
        cursor = page.value.nextCursor;
      }
    },
  });

export const grantStaffMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...staffScopes.all(), 'grant'],
    call: (input: StaffGrantInput) => api.grantStaff(input),
  });

export const revokeStaffMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...staffScopes.all(), 'revoke'],
    call: (input: StaffRevokeInput) => api.revokeStaff(input),
  });

/** Both staff writes change the roster, so both invalidate the staff list scope. */
export const staffInvalidates = () => ({ queryKey: staffScopes.lists() });

export const domainsQuery = (api: ApiClient) =>
  defineQuery({
    queryKey: domainsScopes.lists(),
    call: ({ signal }) => api.listDomains(signal),
  });

export const addDomainMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...domainsScopes.all(), 'add'],
    call: (input: DomainAddInput) => api.addDomain(input),
  });

export const checkDomainMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...domainsScopes.all(), 'check'],
    call: (input: DomainCheckInput) => api.checkDomain(input),
  });

export const removeDomainMutation = (api: ApiClient) =>
  defineMutation({
    mutationKey: [...domainsScopes.all(), 'remove'],
    call: (input: DomainRemoveInput) => api.removeDomain(input),
  });

/** Every domain write changes the roster, so all invalidate the domain list scope. */
export const domainsInvalidates = () => ({ queryKey: domainsScopes.lists() });

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

export const requestMagicLinkMutation = (auth: AuthClientPort) =>
  defineMutation({
    mutationKey: [...authScopes.all(), 'magic-link'],
    call: (input: MagicLinkRequest) => auth.requestMagicLink(input),
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
