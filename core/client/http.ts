import { type z } from 'zod';

import {
  API_ROUTES,
  looseEnvelopeSchema,
  healthOutputSchema,
  meOutputSchema,
  tenantCreateOutputSchema,
  tenantListOutputSchema,
  todoCreateOutputSchema,
  todoListOutputSchema,
  type HttpMethod,
  type ReadMethod,
  type TenantCreateInput,
  type WriteMethod,
} from '#core/contract/index.js';
import { err, internal, ok, type AppError, type NewTodo, type Result } from '#core/domain/index.js';

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
