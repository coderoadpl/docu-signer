import type { Context, Env, Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  PUBLIC_API_PREFIX,
  PUBLIC_API_ROUTES,
  publicCacheControl,
  publicVersionSchema,
} from '#core/contract/index.js';
import { canonicalSlugSchema, err, ok, validation } from '#core/domain/index.js';
import { getPublicTenantProfile } from '#core/server/index.js';

import type { AppDeps } from './composition.js';
import { respond } from './respond.js';

/**
 * The public, unauthenticated contract group (US-028, FR-23, §Public surface).
 * Registered onto the main app BEFORE the `/api/*` tenant-resolution middleware,
 * so a `/api/public/*` request is answered here and never reaches identity
 * resolution or `authorize`. It calls only `getPublicTenantProfile` — a use-case
 * that takes no `ctx: { identity }` — so a public handler structurally cannot
 * touch a tenant-scoped, identity-bearing use-case (US-028 AC, enforced by a
 * config-regression probe).
 *
 * CORS is open (`origin: '*'`, `GET` + its `OPTIONS` preflight) and scoped to
 * this prefix ONLY; the authenticated `/api/*` surface stays CORS-closed
 * (architecture §Security baseline). The slug addresses the tenant, so the same
 * URL is shareable on the apex or any tenant domain (FR-24).
 */
export const registerPublicRoutes = <E extends Env>(
  app: Hono<E>,
  deps: Pick<AppDeps, 'tenants'>,
): void => {
  app.use(`${PUBLIC_API_PREFIX}/*`, cors({ origin: '*', allowMethods: ['GET'] }));

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
};
