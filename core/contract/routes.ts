import { z } from 'zod';

import {
  cardListQuerySchema,
  cardMoveSchema,
  cardSchema,
  type domainAddInputSchema,
  type domainCheckInputSchema,
  type domainRemoveInputSchema,
  memberExportSchema,
  memberRefSchema,
  memberSchema,
  memberUpdateSchema,
  membershipSchema,
  newCardSchema,
  newMemberSchema,
  newTodoSchema,
  grantAdminInputSchema,
  publicTenantProfileSchema,
  revokeAdminInputSchema,
  slugSchema,
  staffMemberSchema,
  staffRoleSchema,
  tenantDomainSchema,
  tenantSchema,
  todoSchema,
} from '#core/domain/index.js';

/**
 * Single source of truth for the HTTP API shared by server and all clients.
 * Every route is described by its method, path and zod schemas; the server
 * implements them, `core/client` consumes them. Neither side hand-writes URLs
 * or response types anywhere else.
 */

/**
 * Deploy attestation carried by every health response: the release version and
 * the build's commit SHA. `smoke:remote` compares the SHA against the deploy
 * event's SHA to prove it verified the deployment it thinks it did.
 */
export const attestationSchema = z.object({
  version: z.string(),
  sha: z.string(),
});

/**
 * Liveness (`/api/health/live`): the process is up and can serve. No database
 * touch — always 200 as long as the process answers. Attestation only.
 */
export const healthLiveOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
});

/**
 * Readiness (`/api/health/ready`): the process AND its database are ready. A
 * successful body always reports `database: 'up'`; a down database returns the
 * `unavailable` error envelope (HTTP 503), never a 200.
 */
export const healthReadyOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.literal('up'),
});

/**
 * Compat `/api/health`: 200 with the database status inline (readiness info
 * without the non-200 gate). New callers should use `/live` for liveness or
 * `/ready` for a readiness gate that goes non-200 when the database is down.
 */
export const healthOutputSchema = attestationSchema.extend({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
});

/**
 * The unauthenticated client config read: which optional auth methods the server
 * has wired, so the login/register pages render the Google button only when the
 * provider is actually configured (FR-26 present-both-or-dormant gating). It
 * exposes flags only — never a secret.
 */
export const authConfigOutputSchema = z.object({
  googleEnabled: z.boolean(),
});

export const meOutputSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  tenant: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      staffRole: staffRoleSchema.nullable(),
      memberId: z.string().nullable(),
    })
    .nullable(),
});

export const tenantListOutputSchema = z.object({
  tenants: z.array(membershipSchema),
});

export const todoListOutputSchema = z.object({
  todos: z.array(todoSchema),
});

export const tenantCreateInputSchema = z.object({
  slug: slugSchema,
  name: z.string(),
});

export type TenantCreateInput = z.input<typeof tenantCreateInputSchema>;

export const tenantCreateOutputSchema = z.object({
  tenant: tenantSchema,
});

export const todoCreateInputSchema = newTodoSchema;

export const todoCreateOutputSchema = z.object({
  todo: todoSchema,
});

/**
 * The card list is board-scoped via an optional `?board=` query param (absent =
 * personal). Additive: an old client that sends no query still reads its
 * personal board.
 */
export const cardsListQuerySchema = cardListQuerySchema;

export const cardsListOutputSchema = z.object({
  cards: z.array(cardSchema),
});

export const cardCreateInputSchema = newCardSchema;

export const cardCreateOutputSchema = z.object({
  card: cardSchema,
});

export const cardMoveInputSchema = cardMoveSchema;

export const cardMoveOutputSchema = z.object({
  card: cardSchema,
});

export const memberListOutputSchema = z.object({
  members: z.array(memberSchema),
});

export const memberEnsureInputSchema = newMemberSchema;

export type MemberEnsureInput = z.input<typeof memberEnsureInputSchema>;

export const memberEnsureOutputSchema = z.object({
  member: memberSchema,
  created: z.boolean(),
});

export const memberUpdateInputSchema = memberUpdateSchema;

export type MemberUpdateInput = z.input<typeof memberUpdateInputSchema>;

export const memberUpdateOutputSchema = z.object({
  member: memberSchema,
});

export const memberRemoveInputSchema = memberRefSchema;

export type MemberRemoveInput = z.input<typeof memberRemoveInputSchema>;

export const memberRemoveOutputSchema = z.object({
  memberId: z.string(),
  deleted: z.object({ members: z.number().int() }),
});

/** The export id travels as a `?id=` query param (a read, so a GET, not a body). */
export const memberExportQuerySchema = memberRefSchema;

export const memberExportOutputSchema = memberExportSchema;

export const staffListOutputSchema = z.object({
  staff: z.array(staffMemberSchema),
});

export const staffGrantInputSchema = grantAdminInputSchema;

export type StaffGrantInput = z.input<typeof staffGrantInputSchema>;

export const staffGrantOutputSchema = z.object({
  staff: staffMemberSchema,
  granted: z.boolean(),
});

export const staffRevokeInputSchema = revokeAdminInputSchema;

export type StaffRevokeInput = z.input<typeof staffRevokeInputSchema>;

export const staffRevokeOutputSchema = z.object({
  userId: z.string(),
  revoked: z.number().int(),
});

/**
 * The public target a tenant points a custom domain at, surfaced with the domain
 * list so the web add-flow can render the exact DNS record to create (US-019).
 * Both nullable: the `noop` provisioner (dev default) configures neither, so the
 * UI falls back to generic guidance; `caddy` self-host and the Vercel target
 * (`SELF_HOST_TARGET_CNAME`) set exactly one.
 */
export const domainTargetSchema = z.object({
  cname: z.string().nullable(),
  ip: z.string().nullable(),
});

export const domainListOutputSchema = z.object({
  domains: z.array(tenantDomainSchema),
  target: domainTargetSchema,
});

export type DomainAddInput = z.input<typeof domainAddInputSchema>;

export const domainAddOutputSchema = z.object({ domain: tenantDomainSchema });

export type DomainCheckInput = z.input<typeof domainCheckInputSchema>;

export const domainCheckOutputSchema = z.object({
  domain: tenantDomainSchema,
  check: z.object({ resolved: z.boolean(), detail: z.string() }),
});

export type DomainRemoveInput = z.input<typeof domainRemoveInputSchema>;

export const domainRemoveOutputSchema = z.object({
  domain: z.string(),
  removed: z.number().int(),
});

/**
 * The public, unauthenticated contract group (US-028, FR-23, §Public surface).
 * A STRUCTURALLY DISTINCT registry with its own `/api/public/...` prefix so a
 * probe can gate the whole group: these routes take no identity, carry open CORS
 * and cacheable responses, and — unlike everything in `API_ROUTES` — never reach
 * a tenant-scoped use-case. `discovery` returns the current content version;
 * `profile` is the version-keyed, long-cached payload (busting is by the version
 * in the URL, per architecture §HTTP caching).
 */
export const PUBLIC_API_PREFIX = '/api/public';

export const PUBLIC_API_ROUTES = {
  tenantDiscovery: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug` },
  tenantProfile: { method: 'GET', path: `${PUBLIC_API_PREFIX}/tenants/:slug/v/:version` },
} as const;

/** The cache-key token derived by `tenantContentVersion` — base36, URL-safe. */
export const publicVersionSchema = z
  .string()
  .regex(/^[a-z0-9]+$/, 'A content version is a base36 token');

export const publicTenantDiscoveryOutputSchema = z.object({
  slug: z.string(),
  contentVersion: z.string(),
});

export const publicTenantProfileOutputSchema = publicTenantProfileSchema;

const fillPath = (template: string, params: Record<string, string>): string =>
  template.replace(/:([a-z]+)/gi, (_, key: string) => encodeURIComponent(params[key] ?? ''));

export const publicTenantDiscoveryPath = (slug: string): string =>
  fillPath(PUBLIC_API_ROUTES.tenantDiscovery.path, { slug });

export const publicTenantProfilePath = (slug: string, version: string): string =>
  fillPath(PUBLIC_API_ROUTES.tenantProfile.path, { slug, version });

/**
 * Every route carries its HTTP method so clients can discriminate reads from
 * writes at the type level (CQRS partition). Safe GETs are queries; unsafe
 * verbs are commands. `core/client` brands its call surface from these methods.
 */
export const API_ROUTES = {
  health: { method: 'GET', path: '/api/health' },
  healthLive: { method: 'GET', path: '/api/health/live' },
  healthReady: { method: 'GET', path: '/api/health/ready' },
  config: { method: 'GET', path: '/api/config' },
  me: { method: 'GET', path: '/api/me' },
  tenants: { method: 'GET', path: '/api/tenants' },
  tenantsCreate: { method: 'POST', path: '/api/tenants' },
  todos: { method: 'GET', path: '/api/todos' },
  todosCreate: { method: 'POST', path: '/api/todos' },
  cards: { method: 'GET', path: '/api/cards' },
  cardsCreate: { method: 'POST', path: '/api/cards' },
  cardsMove: { method: 'POST', path: '/api/cards/move' },
  members: { method: 'GET', path: '/api/members' },
  membersEnsure: { method: 'POST', path: '/api/members' },
  membersUpdate: { method: 'POST', path: '/api/members/update' },
  membersRemove: { method: 'POST', path: '/api/members/remove' },
  membersExport: { method: 'GET', path: '/api/members/export' },
  staff: { method: 'GET', path: '/api/staff' },
  staffGrant: { method: 'POST', path: '/api/staff' },
  staffRevoke: { method: 'POST', path: '/api/staff/revoke' },
  domains: { method: 'GET', path: '/api/domains' },
  domainsAdd: { method: 'POST', path: '/api/domains' },
  domainsCheck: { method: 'POST', path: '/api/domains/check' },
  domainsRemove: { method: 'POST', path: '/api/domains/remove' },
} as const;

export type HttpMethod = (typeof API_ROUTES)[keyof typeof API_ROUTES]['method'];
export type ReadMethod = Extract<HttpMethod, 'GET'>;
export type WriteMethod = Exclude<HttpMethod, ReadMethod>;

export const API_PATHS = {
  health: API_ROUTES.health.path,
  healthLive: API_ROUTES.healthLive.path,
  healthReady: API_ROUTES.healthReady.path,
  config: API_ROUTES.config.path,
  me: API_ROUTES.me.path,
  tenants: API_ROUTES.tenants.path,
  todos: API_ROUTES.todos.path,
  cards: API_ROUTES.cards.path,
  cardsMove: API_ROUTES.cardsMove.path,
  members: API_ROUTES.members.path,
  membersUpdate: API_ROUTES.membersUpdate.path,
  membersRemove: API_ROUTES.membersRemove.path,
  membersExport: API_ROUTES.membersExport.path,
  staff: API_ROUTES.staff.path,
  staffRevoke: API_ROUTES.staffRevoke.path,
  domains: API_ROUTES.domains.path,
  domainsCheck: API_ROUTES.domainsCheck.path,
  domainsRemove: API_ROUTES.domainsRemove.path,
} as const;

/** Header used by non-browser clients (CLI, tests) to select the tenant. */
export const TENANT_HEADER = 'x-tenant';
