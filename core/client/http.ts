import { type z } from 'zod';

import {
  API_ROUTES,
  documentCreateOutputSchema,
  documentDeleteOutputSchema,
  documentFileDeleteOutputSchema,
  documentFileOutputSchema,
  documentGetOutputSchema,
  documentListOutputSchema,
  documentUpdateOutputSchema,
  fileUploadRequestOutputSchema,
  healthOutputSchema,
  looseEnvelopeSchema,
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
import {
  err,
  internal,
  ok,
  type AppError,
  type CreateDocument,
  type DocumentListFilter,
  type FileUploadRequest,
  type FinalizeFileUpload,
  type NewTodo,
  type Result,
  type UpdateDocument,
} from '#core/domain/index.js';

declare const HTTP_METHOD_BRAND: unique symbol;

type Branded<T, M extends HttpMethod> = T & { readonly [HTTP_METHOD_BRAND]?: M };
export type ReadResult<T> = Branded<Result<T, AppError>, ReadMethod>;
export type WriteResult<T> = Branded<Result<T, AppError>, WriteMethod>;

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  headers?: () => Record<string, string>;
  traceparent?: () => string | undefined;
}

const request = async <S extends z.ZodTypeAny, M extends HttpMethod>(
  options: ApiClientOptions,
  method: M,
  path: string,
  outputSchema: S,
  body?: BodyInit,
  contentType?: string,
  signal?: AbortSignal,
): Promise<Branded<Result<z.output<S>, AppError>, M>> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const traceparent = options.traceparent?.();
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers: {
        ...(contentType === undefined ? {} : { 'content-type': contentType }),
        ...(traceparent === undefined ? {} : { traceparent }),
        ...options.headers?.(),
      },
      body: body ?? null,
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
  if (!envelope.success) return err(internal(`Response from ${path} does not match the contract envelope`));
  if (!envelope.data.ok) return err(envelope.data.error);
  const data = outputSchema.safeParse(envelope.data.data);
  return data.success
    ? ok(data.data)
    : err(internal(`Response data from ${path} does not match the contract`));
};

const jsonBody = (input: unknown): string => JSON.stringify(input);

const binaryBody = (bytes: Uint8Array): ArrayBuffer => {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
};

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
  try {
    const response = await fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: binaryBody(input.bytes),
      signal: signal ?? null,
    });
    return response.ok
      ? ok(undefined)
      : err(internal(`Direct upload failed (HTTP ${response.status})`));
  } catch (cause) {
    return err(internal(`Network error uploading file: ${String(cause)}`));
  }
};

const pathWith = (path: string, values: Record<string, string>): string => {
  let resolved = path;
  for (const [name, value] of Object.entries(values)) {
    resolved = resolved.replace(`:${name}`, encodeURIComponent(value));
  }
  return resolved;
};

export const documentFileContentPath = (documentId: string, fileId: string): string =>
  pathWith(API_ROUTES.documentFileContent.path, { documentId, fileId });

const listPath = (filter: DocumentListFilter): string => {
  const query = new URLSearchParams();
  if (filter.docType) query.set('docType', filter.docType);
  if (filter.person) query.set('person', filter.person);
  if (filter.text) query.set('text', filter.text);
  if (filter.dateFrom) query.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) query.set('dateTo', filter.dateTo);
  const suffix = query.toString();
  return suffix ? `${API_ROUTES.documents.path}?${suffix}` : API_ROUTES.documents.path;
};

export const createApiClient = (options: ApiClientOptions) => ({
  health: (signal?: AbortSignal) =>
    request(options, API_ROUTES.health.method, API_ROUTES.health.path, healthOutputSchema, undefined, undefined, signal),
  me: (signal?: AbortSignal) =>
    request(options, API_ROUTES.me.method, API_ROUTES.me.path, meOutputSchema, undefined, undefined, signal),
  listTenants: (signal?: AbortSignal) =>
    request(options, API_ROUTES.tenants.method, API_ROUTES.tenants.path, tenantListOutputSchema, undefined, undefined, signal),
  createTenant: (input: TenantCreateInput, signal?: AbortSignal) =>
    request(options, API_ROUTES.tenantsCreate.method, API_ROUTES.tenantsCreate.path, tenantCreateOutputSchema, jsonBody(input), 'application/json', signal),
  listTodos: (signal?: AbortSignal) =>
    request(options, API_ROUTES.todos.method, API_ROUTES.todos.path, todoListOutputSchema, undefined, undefined, signal),
  addTodo: (input: NewTodo, signal?: AbortSignal) =>
    request(options, API_ROUTES.todosCreate.method, API_ROUTES.todosCreate.path, todoCreateOutputSchema, jsonBody(input), 'application/json', signal),
  listDocuments: (filter: DocumentListFilter = {}, signal?: AbortSignal) =>
    request(options, API_ROUTES.documents.method, listPath(filter), documentListOutputSchema, undefined, undefined, signal),
  createDocument: (input: CreateDocument, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentsCreate.method, API_ROUTES.documentsCreate.path, documentCreateOutputSchema, jsonBody(input), 'application/json', signal),
  getDocument: (documentId: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.document.method, pathWith(API_ROUTES.document.path, { documentId }), documentGetOutputSchema, undefined, undefined, signal),
  updateDocument: (documentId: string, input: UpdateDocument, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentUpdate.method, pathWith(API_ROUTES.documentUpdate.path, { documentId }), documentUpdateOutputSchema, jsonBody(input), 'application/json', signal),
  deleteDocument: (documentId: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentDelete.method, pathWith(API_ROUTES.documentDelete.path, { documentId }), documentDeleteOutputSchema, undefined, undefined, signal),
  requestFileUpload: (documentId: string, input: FileUploadRequest, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentFileUploadRequest.method, pathWith(API_ROUTES.documentFileUploadRequest.path, { documentId }), fileUploadRequestOutputSchema, jsonBody(input), 'application/json', signal),
  finalizeFileUpload: (documentId: string, input: FinalizeFileUpload, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentFileFinalize.method, pathWith(API_ROUTES.documentFileFinalize.path, { documentId }), documentFileOutputSchema, jsonBody(input), 'application/json', signal),
  serverUpload: (documentId: string, input: FileUploadRequest & { bytes: Uint8Array }, signal?: AbortSignal) => {
    const query = new URLSearchParams({ fileName: input.fileName, role: input.role });
    return request(options, API_ROUTES.documentFileServerUpload.method, `${pathWith(API_ROUTES.documentFileServerUpload.path, { documentId })}?${query.toString()}`, documentFileOutputSchema, binaryBody(input.bytes), input.contentType, signal);
  },
  removeFile: (documentId: string, fileId: string, signal?: AbortSignal) =>
    request(options, API_ROUTES.documentFileDelete.method, pathWith(API_ROUTES.documentFileDelete.path, { documentId, fileId }), documentFileDeleteOutputSchema, undefined, undefined, signal),
  fileContentUrl: (documentId: string, fileId: string) =>
    `${options.baseUrl}${documentFileContentPath(documentId, fileId)}`,
  directFileUpload: (input: DirectFileUploadInput, signal?: AbortSignal) =>
    directFileUpload(options, input, signal),
});

export type ApiClient = ReturnType<typeof createApiClient>;

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
