import { context, trace } from '@opentelemetry/api';

import { createBetterAuthClientAdapter } from '#adapters/auth/client-adapter.js';
import {
  changePasswordMutation,
  configQuery,
  approveDocumentMutation,
  apiTokensInvalidates,
  apiTokensQuery,
  createApiClient,
  createApiTokenMutation,
  createDocumentMutation,
  createSavedSearchMutation,
  deleteDocumentFileMutation,
  deleteDocumentMutation,
  deleteSavedSearchMutation,
  disableTwoFactorMutation,
  directFileUploadMutation,
  documentFileQuery,
  documentQuery,
  documentsInvalidates,
  documentsQuery,
  enableTwoFactorMutation,
  exportDocumentsMutation,
  finalizeFileUploadMutation,
  meInvalidates,
  meQuery,
  moveDocumentFileMutation,
  passkeysInvalidates,
  passkeysQuery,
  registerPasskeyMutation,
  removePasskeyMutation,
  revokeApiTokenMutation,
  purgeDocumentMutation,
  requestFileUploadMutation,
  requestMagicLinkMutation,
  savedSearchesInvalidates,
  savedSearchesQuery,
  requestPasswordResetMutation,
  resetPasswordMutation,
  restoreDocumentMutation,
  signInMutation,
  signInPasskeyMutation,
  signInSocialMutation,
  signOutMutation,
  signUpMutation,
  setUserPreferenceMutation,
  updateDocumentMutation,
  uploadDocumentFileMutation,
  userPreferenceInvalidates,
  userPreferenceQuery,
  verifyTotpMutation,
  trashedDocumentsQuery,
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
  trashedDocuments: trashedDocumentsQuery(apiClient),
  document: (documentId: string) => documentQuery(apiClient, documentId),
  documentFile: (documentId: string, fileId: string) =>
    documentFileQuery(apiClient, documentId, fileId),
  createDocument: createDocumentMutation(apiClient),
  updateDocument: updateDocumentMutation(apiClient),
  approveDocument: approveDocumentMutation(apiClient),
  deleteDocument: deleteDocumentMutation(apiClient),
  restoreDocument: restoreDocumentMutation(apiClient),
  purgeDocument: purgeDocumentMutation(apiClient),
  requestFileUpload: requestFileUploadMutation(apiClient),
  finalizeFileUpload: finalizeFileUploadMutation(apiClient),
  uploadDocumentFile: uploadDocumentFileMutation(apiClient),
  directFileUpload: directFileUploadMutation(apiClient),
  deleteDocumentFile: deleteDocumentFileMutation(apiClient),
  moveDocumentFile: moveDocumentFileMutation(apiClient),
  documentFileContentUrl: apiClient.documentFileContentUrl,
  documentFileExportUrl: apiClient.documentFileExportUrl,
  exportDocuments: exportDocumentsMutation(apiClient),
  documentsInvalidates,
  signUp: signUpMutation(authClient),
  signIn: signInMutation(authClient),
  signOut: signOutMutation(authClient),
  changePassword: changePasswordMutation(authClient),
  requestMagicLink: requestMagicLinkMutation(authClient),
  requestPasswordReset: requestPasswordResetMutation(authClient),
  resetPassword: resetPasswordMutation(authClient),
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

export const apiTokenActions = {
  apiTokens: apiTokensQuery(apiClient),
  createApiToken: createApiTokenMutation(apiClient),
  revokeApiToken: revokeApiTokenMutation(apiClient),
  apiTokensInvalidates,
};

export const preferenceActions = {
  userPreference: (key: string) => userPreferenceQuery(apiClient, key),
  setUserPreference: setUserPreferenceMutation(apiClient),
  userPreferenceInvalidates,
};

export const savedSearchActions = {
  savedSearches: savedSearchesQuery(apiClient),
  createSavedSearch: createSavedSearchMutation(apiClient),
  deleteSavedSearch: deleteSavedSearchMutation(apiClient),
  savedSearchesInvalidates,
};
