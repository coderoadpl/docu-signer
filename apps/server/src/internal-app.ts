import { Hono } from 'hono';

import type { TenantDomainRepository } from '#core/server/index.js';

/**
 * The internal control-plane app, mounted ONLY by the self-host entry
 * (`entry.node.ts`) on a SEPARATE port (`INTERNAL_PORT`). In the compose stack
 * that port is reachable only on the private container network — never published
 * to the host — so these routes cannot be hit from the public internet.
 * Network-internal isolation beats path-obscurity: even a routing mistake on the
 * public app can't expose this surface, because it does not run in the public app
 * at all.
 *
 * Surfaces:
 *   - `GET /internal/domain-check` — Caddy's `on_demand_tls { ask }` before
 *     issuing a certificate: 200 only for a verified `tenant_domains` row.
 */
export const buildInternalApp = (deps: {
  tenantDomains: TenantDomainRepository;
}) => {
  const app = new Hono();

  app.get('/internal/domain-check', async (c) => {
    const domain = c.req.query('domain')?.trim().toLowerCase();
    if (!domain) return c.text('missing domain', 400);
    const match = await deps.tenantDomains.findByDomain(domain);
    return match ? c.text('ok', 200) : c.text('unknown domain', 404);
  });

  return app;
};
