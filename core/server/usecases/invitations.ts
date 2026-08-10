import {
  acceptInvitationSchema,
  appError,
  createInvitationSchema,
  err,
  notFound,
  ok,
  validation,
  type AcceptInvitation,
  type AppError,
  type CreateInvitation,
  type Invitation,
  type PublicInvitation,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type {
  EmailPort,
  IdGenerator,
  InvitationAuthPort,
  InvitationRepository,
  InvitationSecretPort,
} from '../ports.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitationDeps {
  invitations: InvitationRepository;
  invitationSecrets: InvitationSecretPort;
  invitationAuth: InvitationAuthPort;
  ids: IdGenerator;
  now: () => Date;
  baseUrl: string;
  baseDomain: string;
  invitationEmail: EmailPort | null;
}

export interface CreatedInvitation {
  invitation: Invitation;
  url: string;
  emailSent: boolean;
}

const invitationUrl = (
  baseUrl: string,
  baseDomain: string,
  tenantSlug: string | null,
  token: string,
): string => {
  const url = new URL(baseUrl);
  if (tenantSlug && baseDomain === 'localhost' && url.hostname === baseDomain) {
    url.hostname = `${tenantSlug}.${baseDomain}`;
  }
  url.pathname = `/zaproszenie/${encodeURIComponent(token)}`;
  return url.toString();
};

export const createInvitation = async (
  ctx: Ctx,
  input: CreateInvitation,
  deps: InvitationDeps,
): Promise<Result<CreatedInvitation, AppError>> => {
  const scope = authorizeTenant(ctx, 'invitation:manage');
  if (!scope.ok) return scope;
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid invitation', parsed.error.flatten()));
  if (await deps.invitations.hasAccount(parsed.data.email)) {
    return err(appError('conflict', 'An account with this email already exists'));
  }
  const token = deps.invitationSecrets.generate();
  const invitation = await deps.invitations.createOrReplace({
    id: deps.ids.nextId(),
    tenantId: scope.value,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: ctx.identity.userId,
    tokenHash: deps.invitationSecrets.hash(token),
    expiresAt: new Date(deps.now().getTime() + INVITATION_TTL_MS).toISOString(),
  });
  const url = invitationUrl(deps.baseUrl, deps.baseDomain, ctx.identity.tenantSlug, token);
  if (deps.invitationEmail) {
    await deps.invitationEmail.sendMail({
      to: invitation.email,
      subject: 'Zaproszenie do archiwum Podpisy',
      text: `Otrzymujesz zaproszenie do archiwum Podpisy.\n\nUstaw hasło i dołącz:\n${url}`,
      link: url,
    });
  }
  return ok({ invitation, url, emailSent: deps.invitationEmail !== null });
};

export const listInvitations = async (
  ctx: Ctx,
  deps: InvitationDeps,
): Promise<Result<Invitation[], AppError>> => {
  const scope = authorizeTenant(ctx, 'invitation:manage');
  if (!scope.ok) return scope;
  await deps.invitations.expirePastDue(scope.value, deps.now().toISOString());
  return ok(await deps.invitations.listByTenant(scope.value));
};

export const revokeInvitation = async (
  ctx: Ctx,
  invitationId: string,
  deps: InvitationDeps,
): Promise<Result<void, AppError>> => {
  const scope = authorizeTenant(ctx, 'invitation:manage');
  if (!scope.ok) return scope;
  return (await deps.invitations.revoke(scope.value, invitationId))
    ? ok(undefined)
    : err(notFound('Invitation not found'));
};

const validInvitation = async (
  token: string,
  deps: InvitationDeps,
): Promise<Result<Invitation & PublicInvitation, AppError>> => {
  const tokenHash = deps.invitationSecrets.hash(token);
  const invitation = await deps.invitations.findByTokenHash(tokenHash);
  if (!invitation || !deps.invitationSecrets.matchesHash(token, invitation.tokenHash)) {
    return err(notFound('Invitation not found'));
  }
  if (invitation.status !== 'pending') {
    return err(appError('conflict', 'Invitation is no longer active'));
  }
  if (new Date(invitation.expiresAt).getTime() <= deps.now().getTime()) {
    await deps.invitations.expire(invitation.id);
    return err(appError('conflict', 'Invitation has expired'));
  }
  return ok(invitation);
};

export const getInvitation = async (
  token: string,
  deps: InvitationDeps,
): Promise<Result<PublicInvitation, AppError>> => {
  const invitation = await validInvitation(token, deps);
  if (!invitation.ok) return invitation;
  return ok({
    email: invitation.value.email,
    organizationName: invitation.value.organizationName,
    status: invitation.value.status,
  });
};

export const acceptInvitation = async (
  token: string,
  input: AcceptInvitation,
  deps: InvitationDeps,
): Promise<Result<{ email: string }, AppError>> => {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return err(validation('Invalid invitation acceptance', parsed.error.flatten()));
  }
  const invitation = await validInvitation(token, deps);
  if (!invitation.ok) return invitation;
  const account = await deps.invitationAuth.createAccount({
    email: invitation.value.email,
    password: parsed.data.password,
    name: invitation.value.email.split('@')[0] ?? invitation.value.email,
  });
  const accepted = await deps.invitations.accept(invitation.value.id, account.userId);
  if (!accepted) return err(appError('conflict', 'Invitation is no longer active'));
  return ok({ email: invitation.value.email });
};
