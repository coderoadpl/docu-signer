import {
  err,
  notFound,
  ok,
  tenantContentVersion,
  type AppError,
  type PublicTenantProfile,
  type Result,
} from '#core/domain/index.js';

import type { TenantRepository } from '../ports.js';

export interface PublicTenantProfileDeps {
  tenants: TenantRepository;
}

/**
 * The public tenant profile read (US-028). Deliberately NOT tenant-scoped: it
 * takes no `ctx: { identity }`, runs no `authorize`, and touches only the safe
 * public projection — so a public HTTP handler wired to it can never reach an
 * identity-bearing use-case (enforced by a config-regression probe; see
 * architecture §Authorization). Addressed by slug, so the same URL is shareable
 * on the apex or any tenant domain (FR-24).
 *
 * `not_found` is generic (no id echoed, no roster) so it does not become a
 * tenant-enumeration oracle beyond the profile's own by-design publicness.
 */
export const getPublicTenantProfile = async (
  input: { slug: string },
  deps: PublicTenantProfileDeps,
): Promise<Result<PublicTenantProfile, AppError>> => {
  const tenant = await deps.tenants.findBySlug(input.slug);
  if (!tenant) return err(notFound('No public profile for this tenant'));
  return ok({
    slug: tenant.slug,
    displayName: tenant.name,
    contentVersion: tenantContentVersion(tenant),
  });
};
