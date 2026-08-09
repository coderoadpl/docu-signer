import { randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createDocumentRepository } from '#adapters/db/documents-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
} from '#adapters/db/repositories.js';
import { createAuth, createAuthPort, type Auth, type GoogleSettings } from '#adapters/auth/create-auth.js';
import { createSesEmailPort } from '#adapters/email/ses.js';
import { createSmtpEmailPort } from '#adapters/email/smtp.js';
import { createLocalFsStorage } from '#adapters/storage/local-fs.js';
import { createVercelBlobStorage } from '#adapters/storage/vercel-blob.js';
import type {
  AuthPort,
  DocumentRepository,
  EmailPort,
  HealthPort,
  IdGenerator,
  StoragePort,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
} from '#core/server/index.js';

import type { Env } from './env.js';

export interface AppDeps {
  auth: Auth;
  authPort: AuthPort;
  documents: DocumentRepository;
  storage: StoragePort;
  tenantDomains: TenantDomainRepository;
  /**
   * Outbound email: the real `smtp` relay (dev/CI point it at a local Mailpit
   * that captures sends) or Amazon SES direct (`ses`). There is no dev transport;
   * dev auth links are read from Mailpit's UI/API, not an in-app route.
   */
  email: EmailPort;
  /** Whether Google social sign-in is wired (FR-26); surfaced to the login page. */
  googleEnabled: boolean;
  /** Whether password-reset email is safe to offer in this environment. */
  passwordResetEnabled: boolean;
  tenants: TenantRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  ids: IdGenerator;
  baseDomain: string;
  /** Build attestation surfaced by the health routes; 'unknown' outside a deploy. */
  commitSha: string;
}

/**
 * Selects the outbound-email transport (composition root). `ses` (Amazon SES
 * direct) fails fast when its AWS credential block is absent — selecting it
 * without keys is a composition error, not a silent no-delivery. `smtp` (the
 * default) needs only a host, which is defaulted to the dev/CI Mailpit; an open
 * relay authenticates no one, so SMTP user/pass are optional.
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
      from: env.EMAIL_FROM,
    });
  }
  if (!env.SMTP_HOST) throw new Error('EMAIL_TRANSPORT=smtp requires SMTP_HOST');
  return createSmtpEmailPort({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER === undefined ? {} : { user: env.SMTP_USER }),
    ...(env.SMTP_PASS === undefined ? {} : { pass: env.SMTP_PASS }),
    from: env.EMAIL_FROM,
  });
};

/** Google is wired only when BOTH keys are present (FR-26), else it stays dormant. */
export const selectGoogleSettings = (env: Env): GoogleSettings | undefined =>
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : undefined;

export const selectPasswordResetEnabled = (env: Env): boolean => {
  const deployed = env.VERCEL !== undefined || env.SECURE_COOKIES;
  if (!deployed) return true;
  if (env.EMAIL_TRANSPORT === 'ses') {
    return Boolean(env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  }
  return env.SMTP_HOST !== 'localhost' && env.EMAIL_FROM !== 'Agentproofarch <no-reply@localhost>';
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

export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const email = selectEmailPort(env);
  const google = selectGoogleSettings(env);
  const passwordResetEnabled = selectPasswordResetEnabled(env);
  const storage = selectStoragePort(env);

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

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.APP_BASE_URL,
    baseDomain: env.APP_BASE_DOMAIN,
    secureCookies: env.SECURE_COOKIES,
    rateLimitEnabled: env.AUTH_RATE_LIMIT,
    disableSignUp: env.AUTH_DISABLE_SIGNUP,
    email,
    ...(google ? { google } : {}),
    trustedOrigins: async () => {
      const domains = await tenantDomains.listVerifiedDomains();
      return [
        ...baseTrustedOrigins,
        ...domains.map((domain) => `https://${domain.domain}`),
        ...domains.map((domain) => `http://${domain.domain}`),
      ];
    },
  });

  return {
    auth,
    authPort: createAuthPort(auth),
    documents: createDocumentRepository(db),
    storage,
    tenantDomains,
    email,
    googleEnabled: google !== undefined,
    passwordResetEnabled,
    tenants: createTenantRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    ids: { nextId: () => randomUUID() },
    baseDomain: env.APP_BASE_DOMAIN,
    commitSha: env.APP_COMMIT_SHA ?? 'unknown',
  };
};
