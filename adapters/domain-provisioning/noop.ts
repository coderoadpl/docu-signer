import type { DomainPort } from '#core/server/index.js';

/**
 * The dev/default DomainPort: no external provisioner exists, so every domain is
 * treated as ready. Selected when `DOMAIN_PROVISIONER` is unset (local dev); a
 * Vercel deployment opts into real provisioning with `DOMAIN_PROVISIONER=vercel`.
 */
export const createNoopDomainPort = (): DomainPort => ({
  provision: async () => {},
  remove: async () => {},
  check: async (domain) => ({ resolved: true, detail: `${domain} accepted (noop provisioner)` }),
});
