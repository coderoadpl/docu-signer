import { type z } from 'zod';

import {
  API_ROUTES,
  authConfigOutputSchema,
  cardCreateOutputSchema,
  cardMoveOutputSchema,
  cardsListOutputSchema,
  domainAddOutputSchema,
  domainCheckOutputSchema,
  domainListOutputSchema,
  domainRemoveOutputSchema,
  looseEnvelopeSchema,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  memberEnsureOutputSchema,
  memberExportOutputSchema,
  memberListOutputSchema,
  memberRemoveOutputSchema,
  memberUpdateOutputSchema,
  meOutputSchema,
  PUBLIC_API_ROUTES,
  publicTenantDiscoveryOutputSchema,
  publicTenantDiscoveryPath,
  publicTenantProfileOutputSchema,
  publicTenantProfilePath,
  staffGrantOutputSchema,
  staffListOutputSchema,
  staffRevokeOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  todoCreateOutputSchema,
  todoListOutputSchema,
  type DomainAddInput,
  type DomainCheckInput,
  type DomainRemoveInput,
  type HttpMethod,
  type MemberEnsureInput,
  type MemberRemoveInput,
  type MemberUpdateInput,
  type ReadMethod,
  type StaffGrantInput,
  type StaffRevokeInput,
  type TenantCreateInput,
  type WriteMethod,
} from '#core/contract/index.js';
import {
  err,
  internal,
  ok,
  type AppError,
  type BoardId,
  type CardMove,
  type NewCard,
  type NewTodo,
  type Result,
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
  listTenants: (signal?: AbortSignal) =>
    request(options, API_ROUTES.tenants.method, API_ROUTES.tenants.path, tenantListOutputSchema, undefined, signal),
  createTenant: (input: TenantCreateInput, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.tenantsCreate.method,
      API_ROUTES.tenantsCreate.path,
      tenantCreateOutputSchema,
      input,
      signal,
    ),
  listTodos: (signal?: AbortSignal) =>
    request(options, API_ROUTES.todos.method, API_ROUTES.todos.path, todoListOutputSchema, undefined, signal),
  addTodo: (input: NewTodo, signal?: AbortSignal) =>
    request(options, API_ROUTES.todosCreate.method, API_ROUTES.todosCreate.path, todoCreateOutputSchema, input, signal),
  listCards: (board: BoardId = 'personal', signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.cards.method,
      `${API_ROUTES.cards.path}?board=${encodeURIComponent(board)}`,
      cardsListOutputSchema,
      undefined,
      signal,
    ),
  addCard: (input: NewCard, signal?: AbortSignal) =>
    request(options, API_ROUTES.cardsCreate.method, API_ROUTES.cardsCreate.path, cardCreateOutputSchema, input, signal),
  moveCard: (input: CardMove, signal?: AbortSignal) =>
    request(options, API_ROUTES.cardsMove.method, API_ROUTES.cardsMove.path, cardMoveOutputSchema, input, signal),
  listMembers: (signal?: AbortSignal) =>
    request(options, API_ROUTES.members.method, API_ROUTES.members.path, memberListOutputSchema, undefined, signal),
  ensureMember: (input: MemberEnsureInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.membersEnsure.method, API_ROUTES.membersEnsure.path, memberEnsureOutputSchema, input, signal),
  updateMember: (input: MemberUpdateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.membersUpdate.method, API_ROUTES.membersUpdate.path, memberUpdateOutputSchema, input, signal),
  removeMember: (input: MemberRemoveInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.membersRemove.method, API_ROUTES.membersRemove.path, memberRemoveOutputSchema, input, signal),
  exportMember: (id: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.membersExport.method,
      `${API_ROUTES.membersExport.path}?id=${encodeURIComponent(id)}`,
      memberExportOutputSchema,
      undefined,
      signal,
    ),
  listStaff: (signal?: AbortSignal) =>
    request(options, API_ROUTES.staff.method, API_ROUTES.staff.path, staffListOutputSchema, undefined, signal),
  grantStaff: (input: StaffGrantInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.staffGrant.method, API_ROUTES.staffGrant.path, staffGrantOutputSchema, input, signal),
  revokeStaff: (input: StaffRevokeInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.staffRevoke.method, API_ROUTES.staffRevoke.path, staffRevokeOutputSchema, input, signal),
  listDomains: (signal?: AbortSignal) =>
    request(options, API_ROUTES.domains.method, API_ROUTES.domains.path, domainListOutputSchema, undefined, signal),
  addDomain: (input: DomainAddInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.domainsAdd.method, API_ROUTES.domainsAdd.path, domainAddOutputSchema, input, signal),
  checkDomain: (input: DomainCheckInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.domainsCheck.method, API_ROUTES.domainsCheck.path, domainCheckOutputSchema, input, signal),
  removeDomain: (input: DomainRemoveInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.domainsRemove.method, API_ROUTES.domainsRemove.path, domainRemoveOutputSchema, input, signal),
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
