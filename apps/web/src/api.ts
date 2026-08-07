import { context, trace } from '@opentelemetry/api';

import { createBetterAuthClientAdapter } from '#adapters/auth/client-adapter.js';
import {
  addTodoInvalidates,
  addTodoMutation,
  createDocumentMutation,
  createApiClient,
  deleteDocumentMutation,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  finalizeFileUploadMutation,
  meQuery,
  removeFileMutation,
  requestFileUploadMutation,
  serverUploadMutation,
  signInMutation,
  signOutMutation,
  signUpMutation,
  tenantsQuery,
  todosQuery,
  updateDocumentMutation,
} from '#core/client/index.js';

/**
 * W3C `traceparent` for the active span, formatted from the OTel facade so FE→BE
 * trace unification is a one-place binding here. Absent (clean no-op) whenever
 * no tracing context is active — the SDK-free default on both deploy targets.
 */
const traceparent = (): string | undefined => {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
};

/** Same-origin: the SPA is always served from the tenant's own domain. */
const apiClient = createApiClient({ baseUrl: '', traceparent });
const authClient = createBetterAuthClientAdapter('');

/**
 * The one binding site. Core/client action factories are bound to their
 * transport (ApiClient, AuthClientPort) exactly once here; features import
 * these ready actions and never see a client, a port or an adapter.
 */
export const actions = {
  me: meQuery(apiClient),
  tenants: tenantsQuery(apiClient),
  todos: todosQuery(apiClient),
  addTodo: addTodoMutation(apiClient),
  addTodoInvalidates,
  documents: documentsQuery.bind(undefined, apiClient),
  document: documentQuery.bind(undefined, apiClient),
  createDocument: createDocumentMutation(apiClient),
  updateDocument: updateDocumentMutation(apiClient),
  deleteDocument: deleteDocumentMutation(apiClient),
  requestFileUpload: requestFileUploadMutation(apiClient),
  finalizeFileUpload: finalizeFileUploadMutation(apiClient),
  serverUpload: serverUploadMutation(apiClient),
  removeFile: removeFileMutation(apiClient),
  documentsInvalidates,
  signUp: signUpMutation(authClient),
  signIn: signInMutation(authClient),
  signOut: signOutMutation(authClient),
};
