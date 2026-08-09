import { context, trace } from '@opentelemetry/api';

import { createBetterAuthClientAdapter } from '#adapters/auth/client-adapter.js';
import {
  configQuery,
  createApiClient,
  createDocumentMutation,
  deleteDocumentFileMutation,
  deleteDocumentMutation,
  disableTwoFactorMutation,
  directFileUploadMutation,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  enableTwoFactorMutation,
  exportDocumentsMutation,
  finalizeFileUploadMutation,
  meInvalidates,
  meQuery,
  passkeysInvalidates,
  passkeysQuery,
  registerPasskeyMutation,
  removePasskeyMutation,
  requestFileUploadMutation,
  requestMagicLinkMutation,
  signInMutation,
  signInPasskeyMutation,
  signInSocialMutation,
  signOutMutation,
  signUpMutation,
  updateDocumentMutation,
  uploadDocumentFileMutation,
  verifyTotpMutation,
} from '#core/client/index.js';

const traceparent = (): string | undefined => {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext) return undefined;
  const flags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
};

const apiClient = createApiClient({ baseUrl: '', traceparent });
const authClient = createBetterAuthClientAdapter('');

export const actions = {
  config: configQuery(apiClient),
  me: meQuery(apiClient),
  meInvalidates,
  documents: (filter: Parameters<typeof documentsQuery>[1]) =>
    documentsQuery(apiClient, filter),
  document: (documentId: string) => documentQuery(apiClient, documentId),
  createDocument: createDocumentMutation(apiClient),
  updateDocument: updateDocumentMutation(apiClient),
  deleteDocument: deleteDocumentMutation(apiClient),
  requestFileUpload: requestFileUploadMutation(apiClient),
  finalizeFileUpload: finalizeFileUploadMutation(apiClient),
  uploadDocumentFile: uploadDocumentFileMutation(apiClient),
  directFileUpload: directFileUploadMutation(apiClient),
  deleteDocumentFile: deleteDocumentFileMutation(apiClient),
  documentFileContentUrl: apiClient.documentFileContentUrl,
  documentFileExportUrl: apiClient.documentFileExportUrl,
  exportDocuments: exportDocumentsMutation(apiClient),
  documentsInvalidates,
  signUp: signUpMutation(authClient),
  signIn: signInMutation(authClient),
  signOut: signOutMutation(authClient),
  requestMagicLink: requestMagicLinkMutation(authClient),
  signInSocial: signInSocialMutation(authClient),
  enableTwoFactor: enableTwoFactorMutation(authClient),
  verifyTotp: verifyTotpMutation(authClient),
  disableTwoFactor: disableTwoFactorMutation(authClient),
  passkeys: passkeysQuery(authClient),
  passkeysInvalidates,
  registerPasskey: registerPasskeyMutation(authClient),
  removePasskey: removePasskeyMutation(authClient),
  signInPasskey: signInPasskeyMutation(authClient),
};
