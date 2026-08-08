import { randomUUID } from 'node:crypto';

import { createDb } from '#adapters/db/client.js';
import { createCardRepository } from '#adapters/db/cards-repository.js';
import { createMemberRepository } from '#adapters/db/members-repository.js';
import { createStaffRepository, createUserDirectory } from '#adapters/db/staff-repository.js';
import {
  createHealthPort,
  createTenantAccessReader,
  createTenantDomainRepository,
  createTenantRepository,
  createTodoRepository,
} from '#adapters/db/repositories.js';
import { createBackfillRepository } from '#adapters/db/backfill-repository.js';
import { createAuth, createAuthPort, type Auth, type GoogleSettings } from '#adapters/auth/create-auth.js';
import { createSesEmailPort } from '#adapters/email/ses.js';
import { createSmtpEmailPort } from '#adapters/email/smtp.js';
import { createCaddyDomainPort } from '#adapters/domain-provisioning/caddy.js';
import { createNoopDomainPort } from '#adapters/domain-provisioning/noop.js';
import { createVercelDomainPort } from '#adapters/domain-provisioning/vercel.js';
import type {
  AuthPort,
  BackfillPort,
  CardRepository,
  Clock,
  DomainPort,
  EmailPort,
  HealthPort,
  IdGenerator,
  MemberRepository,
  StaffRepository,
  TenantAccessReader,
  TenantDomainRepository,
  TenantRepository,
  TodoRepository,
  UserDirectory,
} from '#core/server/index.js';

import type { Env } from './env.js';

export interface AppDeps {
  auth: Auth;
  authPort: AuthPort;
  todos: TodoRepository;
  cards: CardRepository;
  members: MemberRepository;
  staff: StaffRepository;
  users: UserDirectory;
  tenantDomains: TenantDomainRepository;
  /** Domain provisioning/verification: vercel or caddy per target, noop elsewhere. */
  domainPort: DomainPort;
  /**
   * Outbound email: the real `smtp` relay (dev/CI point it at a local Mailpit
   * that captures sends) or Amazon SES direct (`ses`). There is no dev transport;
   * dev magic links are read from Mailpit's UI/API, not an in-app route.
   */
  email: EmailPort;
  /** Whether Google social sign-in is wired (FR-26); surfaced to the login page. */
  googleEnabled: boolean;
  /** The public CNAME/IP a tenant points a custom domain at, surfaced by US-019. */
  domainTarget: { cname: string | null; ip: string | null };
  tenants: TenantRepository;
  tenantAccess: TenantAccessReader;
  health: HealthPort;
  /** C4 batch backfill executor substrate (§Backfills). */
  backfills: BackfillPort;
  /**
   * The shared secret gating the public backfill route on Vercel (no private
   * INTERNAL_PORT there); null → the public route does not mount. Self-host runs
   * the same executor on the network-isolated internal app instead.
   */
  backfillSecret: string | null;
  ids: IdGenerator;
  clock: Clock;
  baseDomain: string;
  tenantCreationMode: Env['TENANT_CREATION'];
  /** Build attestation surfaced by the health routes; 'unknown' outside a deploy. */
  commitSha: string;
}

/**
 * Composition root — the ONLY place where env decides which adapters run.
 * Platform names (vercel, neon) may appear here and in adapters, never in core.
 */
// Exported for unit tests: selecting the adapter must be testable without
// constructing the full graph — a real Better Auth instance eagerly queries
// tenant_domains for trustedOrigins, which has no database on the check runner.
export const selectDomainPort = (env: Env): DomainPort => {
  // `vercel` is never inferred from running on Vercel (the platform env carries no
  // API token): selecting it without its credentials is a composition error, not a
  // deploy that silently stops attaching tenant domains.
  if (env.DOMAIN_PROVISIONER === 'vercel') {
    if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) {
      throw new Error('DOMAIN_PROVISIONER=vercel requires VERCEL_TOKEN and VERCEL_PROJECT_ID');
    }
    return createVercelDomainPort({
      token: env.VERCEL_TOKEN,
      projectId: env.VERCEL_PROJECT_ID,
      ...(env.VERCEL_TEAM_ID === undefined ? {} : { teamId: env.VERCEL_TEAM_ID }),
    });
  }
  if (env.DOMAIN_PROVISIONER === 'caddy') {
    return createCaddyDomainPort({
      targetCname: env.SELF_HOST_TARGET_CNAME,
      targetIp: env.SELF_HOST_TARGET_IP,
    });
  }
  return createNoopDomainPort();
};

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

export const createDeps = (env: Env): AppDeps => {
  const db = createDb(env.DB_DRIVER, env.DATABASE_URL);
  const tenantDomains = createTenantDomainRepository(db);
  const domainPort = selectDomainPort(env);
  const email = selectEmailPort(env);
  const google = selectGoogleSettings(env);

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
    todos: createTodoRepository(db),
    cards: createCardRepository(db),
    members: createMemberRepository(db),
    staff: createStaffRepository(db),
    users: createUserDirectory(db),
    tenantDomains,
    domainPort,
    email,
    googleEnabled: google !== undefined,
    domainTarget: {
      cname: env.SELF_HOST_TARGET_CNAME ?? null,
      ip: env.SELF_HOST_TARGET_IP ?? null,
    },
    tenants: createTenantRepository(db),
    tenantAccess: createTenantAccessReader(db),
    health: createHealthPort(db),
    backfills: createBackfillRepository(db),
    backfillSecret: env.INTERNAL_BACKFILL_SECRET ?? null,
    ids: { nextId: () => randomUUID() },
    clock: { nowIso: () => new Date().toISOString() },
    baseDomain: env.APP_BASE_DOMAIN,
    tenantCreationMode: env.TENANT_CREATION,
    commitSha: env.APP_COMMIT_SHA ?? 'unknown',
  };
};
