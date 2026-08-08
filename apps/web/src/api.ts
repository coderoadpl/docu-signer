import { context, trace } from '@opentelemetry/api';

import { createBetterAuthClientAdapter } from '#adapters/auth/client-adapter.js';
import {
  addDomainMutation,
  addTodoInvalidates,
  addTodoMutation,
  cardsInvalidates,
  cardsQuery,
  checkDomainMutation,
  configQuery,
  createApiClient,
  createTenantMutation,
  disableTwoFactorMutation,
  domainsInvalidates,
  domainsQuery,
  enableTwoFactorMutation,
  ensureMemberInvalidates,
  ensureMemberMutation,
  grantStaffMutation,
  meInvalidates,
  membersQuery,
  meQuery,
  passkeysInvalidates,
  passkeysQuery,
  registerPasskeyMutation,
  removeDomainMutation,
  removePasskeyMutation,
  requestMagicLinkMutation,
  signInPasskeyMutation,
  tenantsInvalidates,
  revokeStaffMutation,
  signInMutation,
  signInSocialMutation,
  signOutMutation,
  signUpMutation,
  staffInvalidates,
  staffQuery,
  tenantsQuery,
  todosQuery,
  verifyTotpMutation,
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
  config: configQuery(apiClient),
  me: meQuery(apiClient),
  meInvalidates,
  tenants: tenantsQuery(apiClient),
  tenantsInvalidates,
  createTenant: createTenantMutation(apiClient),
  todos: todosQuery(apiClient),
  addTodo: addTodoMutation(apiClient),
  addTodoInvalidates,
  members: membersQuery(apiClient),
  ensureMember: ensureMemberMutation(apiClient),
  ensureMemberInvalidates,
  staff: staffQuery(apiClient),
  grantStaff: grantStaffMutation(apiClient),
  revokeStaff: revokeStaffMutation(apiClient),
  staffInvalidates,
  domains: domainsQuery(apiClient),
  addDomain: addDomainMutation(apiClient),
  checkDomain: checkDomainMutation(apiClient),
  removeDomain: removeDomainMutation(apiClient),
  domainsInvalidates,
  board: cardsQuery(apiClient),
  teamBoard: cardsQuery(apiClient, 'team'),
  boardInvalidates: cardsInvalidates,
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

/**
 * The board island's optimistic store persists each edit through this gateway.
 * It maps the typed API client's `Result` to the store's ok/error verdict; the
 * store never sees HTTP, a `Result` or an `AppError`. The shape is validated
 * structurally where `core/board` consumes it (api.ts must not import a feature).
 */
const toGatewayResult = (
  result: Awaited<ReturnType<typeof apiClient.addCard>>,
): { ok: true } | { ok: false; error: string } =>
  result.ok ? { ok: true } : { ok: false, error: result.error.message };

export const boardGateway = {
  addCard: (input: { title: string; column: string }) =>
    apiClient.addCard(input).then(toGatewayResult),
  moveCard: (input: { cardId: string; toColumn: string; toIndex: number }) =>
    apiClient.moveCard(input).then(toGatewayResult),
};

/**
 * The team island's gateway — identical plumbing to `boardGateway`, but every
 * write is scoped to the team board (`board: 'team'`) so the server enforces the
 * team column set and its transition table. The island's optimistic store gates
 * moves through the domain oracle first; this gateway only persists the survivors.
 */
export const teamBoardGateway = {
  addCard: (input: { title: string; column: string }) =>
    apiClient.addCard({ ...input, board: 'team' }).then(toGatewayResult),
  moveCard: (input: { cardId: string; toColumn: string; toIndex: number }) =>
    apiClient.moveCard({ ...input, board: 'team' }).then(toGatewayResult),
};
