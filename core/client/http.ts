import { type z } from 'zod';

import {
  API_ROUTES,
  authConfigOutputSchema,
  documentCreateOutputSchema,
  documentDeleteOutputSchema,
  documentFileDeleteOutputSchema,
  documentFileMoveOutputSchema,
  documentFileOutputSchema,
  documentGetOutputSchema,
  documentListOutputSchema,
  documentUpdateOutputSchema,
  fileUploadRequestOutputSchema,
  looseEnvelopeSchema,
  healthLiveOutputSchema,
  healthOutputSchema,
  healthReadyOutputSchema,
  meOutputSchema,
  PUBLIC_API_ROUTES,
  publicTenantDiscoveryOutputSchema,
  publicTenantDiscoveryPath,
  publicTenantProfileOutputSchema,
  publicTenantProfilePath,
  savedSearchCreateOutputSchema,
  savedSearchDeleteOutputSchema,
  savedSearchListOutputSchema,
  type HttpMethod,
  type ReadMethod,
  type WriteMethod,
} from '#core/contract/index.js';
import {
  err,
  internal,
  ok,
  type AppError,
  type CreateSavedSearch,
  type CreateDocument,
  type DocumentListFilter,
  type ExportDocuments,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type MoveDocumentFile,
  type Result,
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
  getDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.document.method,
      pathWith(API_ROUTES.document.path, { documentId }),
      documentGetOutputSchema,
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
  deleteDocument: (documentId: string, signal?: AbortSignal) =>
    request(
      options,
      API_ROUTES.documentDelete.method,
      pathWith(API_ROUTES.documentDelete.path, { documentId }),
      documentDeleteOutputSchema,
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
    const path =
      pathWith(API_ROUTES.documentFileServerUpload.path, { documentId }) +
      `?fileName=${encodeURIComponent(input.fileName)}&role=${encodeURIComponent(input.role)}`;
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
