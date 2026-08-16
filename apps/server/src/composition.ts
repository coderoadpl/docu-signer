import { randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createDocumentRepository } from '#adapters/db/documents-repository.js';
import { createDocumentLinkRepository } from '#adapters/db/document-links-repository.js';
import { createPadSessionRepository } from '#adapters/db/pad-sessions-repository.js';
import { createSavedSearchRepository } from '#adapters/db/saved-searches-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
} from '#adapters/db/repositories.js';
import {
  createAuth,
  createAuthPort,
  createInvitationAuthPort,
  type Auth,
  type GoogleSettings,
} from '#adapters/auth/create-auth.js';
import {
  createApiTokenSecrets,
  createInvitationSecrets,
  createPadSessionSecrets,
} from '#adapters/auth/api-token-secrets.js';
import { createApiTokenRepository } from '#adapters/db/api-tokens-repository.js';
import { createInvitationRepository } from '#adapters/db/invitations-repository.js';
import { createRateLimitPort } from '#adapters/db/rate-limit.js';
import { createSesEmailPort } from '#adapters/email/ses.js';
import { createSmtpEmailPort } from '#adapters/email/smtp.js';
import { createNoopEmailPort } from '#adapters/email/noop.js';
import { createLocalFsStorage } from '#adapters/storage/local-fs.js';
import { createVercelBlobStorage } from '#adapters/storage/vercel-blob.js';
import { createUserPreferenceRepository } from '#adapters/db/user-preferences-repository.js';
import { createTenantSettingsRepository } from '#adapters/db/tenant-settings-repository.js';
import { createTenantAccountRepository } from '#adapters/db/tenant-accounts-repository.js';
import { createSignatureRecordRepository } from '#adapters/db/signature-records-repository.js';
import { createSourceUpdateRequestRepository } from '#adapters/db/source-update-requests-repository.js';
import {
  createSignPdfSeal,
  pdfSealCertificateSubject,
  type PdfSealCredentials,
} from '#adapters/pdf-seal/signpdf.js';
import { createConsoleWarningLogger } from '#adapters/logging/console-warning.js';
import type {
  AuthPort,
  ApiTokenRepository,
  ApiTokenSecretPort,
  DocumentRepository,
  DocumentLinkRepository,
  EmailPort,
  HealthPort,
  IdGenerator,
  InvitationAuthPort,
  InvitationRepository,
  InvitationSecretPort,
  PadSessionRepository,
  PadSessionSecretPort,
  PdfSealingDeps,
  RateLimitPort,
  SavedSearchRepository,
  SignatureRecordRepository,
  SourceUpdateRequestRepository,
  StoragePort,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
  TenantSettingsRepository,
  TenantAccountRepository,
  UserPreferenceRepository,
} from '#core/server/index.js';

import type { Env } from './env.js';

export interface AppDeps {
  auth: Auth;
  authPort: AuthPort;
  apiTokens: ApiTokenRepository;
  apiTokenSecrets: ApiTokenSecretPort;
  documents: DocumentRepository;
  documentLinks: DocumentLinkRepository;
  padSessions: PadSessionRepository;
  padSessionSecrets: PadSessionSecretPort;
  savedSearches: SavedSearchRepository;
  userPreferences: UserPreferenceRepository;
  tenantSettings: TenantSettingsRepository;
  sealCertificateSubject?: string;
  tenantAccounts: TenantAccountRepository;
  signatureRecords: SignatureRecordRepository;
  sourceUpdateRequests: SourceUpdateRequestRepository;
  pdfSealing?: PdfSealingDeps;
  storage: StoragePort;
  tenantDomains: TenantDomainRepository;
  /**
   * Outbound email uses configured SMTP/SES or a deliberate no-op fallback;
   * invitationEmail exposes only configured delivery to the invitation use-case.
   */
  email: EmailPort;
  invitationEmail: EmailPort | null;
  invitations: InvitationRepository;
  invitationSecrets: InvitationSecretPort;
  invitationAuth: InvitationAuthPort;
  invitationRateLimit: RateLimitPort;
  invitationRateLimitEnabled: boolean;
  emailConfigured: boolean;
  /** Whether Google social sign-in is wired (FR-26); surfaced to the login page. */
  googleEnabled: boolean;
  /** Whether password-reset email is safe to offer in this environment. */
  passwordResetEnabled: boolean;
  tenants: TenantRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  ids: IdGenerator;
  baseDomain: string;
  baseUrl: string;
  now: () => Date;
  /** Build attestation surfaced by the health routes; 'unknown' outside a deploy. */
  commitSha: string;
}

/**
 * Unconfigured SMTP deliberately degrades to a no-op port so invitation creation
 * still succeeds and the UI can surface its copy-link fallback. Explicit SES
 * remains fail-fast because selecting it declares an intent to deliver.
 */
export const selectEmailPort = (env: Env): EmailPort => {
  if (env.EMAIL_TRANSPORT === 'ses') {
    if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('EMAIL_TRANSPORT=ses requires AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }
    return createSesEmailPort({
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      from: env.MAIL_FROM ?? '',
    });
  }
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.MAIL_FROM) return createNoopEmailPort();
  return createSmtpEmailPort({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER === undefined ? {} : { user: env.SMTP_USER }),
    ...(env.SMTP_PASS === undefined ? {} : { pass: env.SMTP_PASS }),
    from: env.MAIL_FROM,
  });
};

export const selectEmailConfigured = (env: Env): boolean =>
  env.EMAIL_TRANSPORT === 'ses'
    ? Boolean(
        env.AWS_REGION &&
        env.AWS_ACCESS_KEY_ID &&
        env.AWS_SECRET_ACCESS_KEY &&
        env.MAIL_FROM,
      )
    : Boolean(env.SMTP_HOST && env.SMTP_PORT && env.MAIL_FROM);

/** Google is wired only when BOTH keys are present (FR-26), else it stays dormant. */
export const selectGoogleSettings = (env: Env): GoogleSettings | undefined =>
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : undefined;

export const selectPasswordResetEnabled = (env: Env): boolean => {
  return selectEmailConfigured(env);
};

export const selectStoragePort = (env: Env): StoragePort => {
  if (env.STORAGE_DRIVER === 'vercel-blob') {
    if (!env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('STORAGE_DRIVER=vercel-blob requires BLOB_READ_WRITE_TOKEN');
    }
    return createVercelBlobStorage(env.BLOB_READ_WRITE_TOKEN);
  }
  return createLocalFsStorage(env.STORAGE_LOCAL_PATH);
};

export const selectPdfSealCredentials = (env: Env): PdfSealCredentials | null => {
  if (env.SEAL_P12_BASE64) {
    return {
      kind: 'p12',
      base64: env.SEAL_P12_BASE64,
      passphrase: env.SEAL_P12_PASSPHRASE,
    };
  }
  return env.SEAL_CERT_PEM && env.SEAL_KEY_PEM
    ? {
        kind: 'pem',
        certificate: env.SEAL_CERT_PEM,
        privateKey: env.SEAL_KEY_PEM,
      }
    : null;
};

export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const email = selectEmailPort(env);
  const emailConfigured = selectEmailConfigured(env);
  const google = selectGoogleSettings(env);
  const passwordResetEnabled = selectPasswordResetEnabled(env);
  const storage = selectStoragePort(env);
  const tenantSettings = createTenantSettingsRepository(db);
  const tenantAccounts = createTenantAccountRepository(db);
  const signatureRecords = createSignatureRecordRepository(db);
  const warnings = createConsoleWarningLogger();
  const pdfSealCredentials = selectPdfSealCredentials(env);
  const pdfSeal = createSignPdfSeal(pdfSealCredentials);
  const sealCertificateSubject = pdfSealCredentials
    ? pdfSealCertificateSubject(pdfSealCredentials)
    : undefined;
  if (!emailConfigured) {
    warnings.warn(
      'Outbound email is not configured; using the no-op email port so invitations remain creatable through the UI copy-link fallback.',
    );
  }

  const baseTrustedOrigins = [
    env.APP_BASE_URL,
    // The deployment's own origin: previews and staging serve the SPA from
    // their generated Vercel URL, so auth POSTs arrive with that Origin.
    ...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : []),
    ...(env.VERCEL_BRANCH_URL ? [`https://${env.VERCEL_BRANCH_URL}`] : []),
    `http://*.${env.APP_BASE_DOMAIN}`,
    `https://*.${env.APP_BASE_DOMAIN}`,
    // Wildcard entries above don't match origins carrying an explicit port.
    `http://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
    `https://*.${env.APP_BASE_DOMAIN}:${env.PORT}`,
  ];

  const trustedOrigins = async () => {
    const domains = await tenantDomains.listVerifiedDomains();
    return [
      ...baseTrustedOrigins,
      ...domains.map((domain) => `https://${domain.domain}`),
      ...domains.map((domain) => `http://${domain.domain}`),
    ];
  };
  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain: env.APP_BASE_DOMAIN,
    secureCookies: env.SECURE_COOKIES,
    rateLimitEnabled: env.AUTH_RATE_LIMIT,
    disableSignUp: env.AUTH_DISABLE_SIGNUP,
    email,
    ...(google ? { google } : {}),
    trustedOrigins,
  });
  const invitationProvisioningAuth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain: env.APP_BASE_DOMAIN,
    secureCookies: env.SECURE_COOKIES,
    rateLimitEnabled: env.AUTH_RATE_LIMIT,
    disableSignUp: false,
    email,
    ...(google ? { google } : {}),
    trustedOrigins,
  });

  return {
    auth,
    authPort: createAuthPort(auth),
    invitationAuth: createInvitationAuthPort(invitationProvisioningAuth),
    invitations: createInvitationRepository(db),
    invitationSecrets: createInvitationSecrets(),
    invitationRateLimit: createRateLimitPort(db),
    invitationRateLimitEnabled: env.AUTH_RATE_LIMIT,
    apiTokens: createApiTokenRepository(db),
    apiTokenSecrets: createApiTokenSecrets(),
    documents: createDocumentRepository(db),
    documentLinks: createDocumentLinkRepository(db),
    padSessions: createPadSessionRepository(db),
    padSessionSecrets: createPadSessionSecrets(),
    savedSearches: createSavedSearchRepository(db),
    userPreferences: createUserPreferenceRepository(db),
    tenantSettings,
    ...(sealCertificateSubject ? { sealCertificateSubject } : {}),
    tenantAccounts,
    signatureRecords,
    sourceUpdateRequests: createSourceUpdateRequestRepository(db),
    pdfSealing: {
      ids: { nextId: () => randomUUID() },
      pdfSeal,
      signatureRecords,
      tenantAccounts,
      tenantSettings,
      warnings,
    },
    storage,
    tenantDomains,
    email,
    invitationEmail: emailConfigured ? email : null,
    emailConfigured,
    googleEnabled: google !== undefined,
    passwordResetEnabled,
    tenants: createTenantRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids: { nextId: () => randomUUID() },
    baseDomain: env.APP_BASE_DOMAIN,
    baseUrl: env.APP_BASE_URL,
    now: () => new Date(),
    commitSha: env.APP_COMMIT_SHA ?? 'unknown',
  };
};
