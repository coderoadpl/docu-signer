import type { Context, Env, Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  PUBLIC_API_PREFIX,
  PUBLIC_API_ROUTES,
  invitationAcceptInputSchema,
  publicCacheControl,
  publicVersionSchema,
} from '#core/contract/index.js';
import { canonicalSlugSchema, err, ok, rateLimited, validation } from '#core/domain/index.js';
import {
  acceptInvitation,
  getInvitation,
  getPublicTenantProfile,
} from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

/**
 * The public, unauthenticated contract group (US-028, FR-23, §Public surface).
 * Registered onto the main app BEFORE the `/api/*` tenant-resolution middleware,
 * so a `/api/public/*` request is answered here and never reaches identity
 * resolution or `authorize`. Its handlers call only the identity-free
 * `getPublicTenantProfile`, `getInvitation`, and `acceptInvitation` use-cases;
 * a config-regression probe rejects references to known tenant-scoped,
 * identity-bearing operations (US-028 AC).
 *
 * CORS is open (`origin: '*'`, `GET`/`POST` + `OPTIONS`) and scoped to this
 * prefix ONLY; the authenticated `/api/*` surface stays CORS-closed
 * (architecture §Security baseline). The slug addresses the tenant, so the same
 * URL is shareable on the apex or any tenant domain (FR-24).
 */
export const registerPublicRoutes = <E extends Env>(
  app: Hono<E>,
  deps: Pick<
    AppDeps,
    | 'tenants'
    | 'invitations'
    | 'invitationSecrets'
    | 'invitationAuth'
    | 'invitationEmail'
    | 'invitationRateLimit'
    | 'invitationRateLimitEnabled'
    | 'ids'
    | 'now'
    | 'baseUrl'
    | 'baseDomain'
  >,
): void => {
  app.use(`${PUBLIC_API_PREFIX}/*`, cors({ origin: '*', allowMethods: ['GET', 'POST'] }));

  app.get(PUBLIC_API_ROUTES.tenantDiscovery.path, async (c: Context) => {
    const slug = canonicalSlugSchema.safeParse(c.req.param('slug'));
    if (!slug.success) return respond(err(validation('Invalid tenant slug', slug.error.flatten())));
    const result = await getPublicTenantProfile({ slug: slug.data }, deps);
    if (!result.ok) return respond(result);
    return respond(
      ok({ slug: result.value.slug, contentVersion: result.value.contentVersion }),
      publicCacheControl('discovery'),
    );
  });

  app.get(PUBLIC_API_ROUTES.tenantProfile.path, async (c: Context) => {
    const slug = canonicalSlugSchema.safeParse(c.req.param('slug'));
    if (!slug.success) return respond(err(validation('Invalid tenant slug', slug.error.flatten())));
    // The path version is a CACHE KEY, not a content selector: the server always
    // returns current content and echoes the current version, so a consumer that
    // requested a stale key sees the bust in the body. Its format is validated
    // only, so a junk key is a 400 (uncached) rather than a cached garbage entry.
    const version = publicVersionSchema.safeParse(c.req.param('version'));
    if (!version.success) {
      return respond(err(validation('Invalid content version', version.error.flatten())));
    }
    const result = await getPublicTenantProfile({ slug: slug.data }, deps);
    return respond(result, result.ok ? publicCacheControl('profile') : 'no-store');
  });

  app.get(PUBLIC_API_ROUTES.invitation.path, async (c) => {
    const result = await getInvitation(c.req.param('token'), deps);
    return respond(result.ok ? ok({ invitation: result.value }) : result);
  });

  app.post(PUBLIC_API_ROUTES.invitationAccept.path, async (c) => {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    const clientKey = forwarded || c.req.header('x-real-ip') || 'unknown';
    if (
      deps.invitationRateLimitEnabled &&
      !(await deps.invitationRateLimit.consume(`invitation-accept:${clientKey}`, 5, 60))
    ) {
      return respond(err(rateLimited('Too many invitation attempts')));
    }
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = invitationAcceptInputSchema.safeParse(body);
    if (!parsed.success) {
      return respond(err(validation('Invalid invitation acceptance', parsed.error.flatten())));
    }
    const result = await acceptInvitation(c.req.param('token'), parsed.data, deps);
    return respond(
      result.ok
        ? ok({ accepted: true as const, email: result.value.email })
        : result,
    );
  });
};
