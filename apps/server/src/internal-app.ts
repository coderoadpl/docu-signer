import { Hono } from 'hono';

import { runBackfillBatch, type BackfillPort, type TenantDomainRepository } from '#core/server/index.js';

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
 *   - `POST /internal/backfills/:name` — one batch of a registered backfill
 *     (§Backfills, C4). Cron-driven; each call processes a bounded page and
 *     persists a checkpoint, so repeated calls drive it to completion.
 */
export const buildInternalApp = (deps: {
  tenantDomains: TenantDomainRepository;
  backfills: BackfillPort;
}) => {
  const app = new Hono();

  app.get('/internal/domain-check', async (c) => {
    const domain = c.req.query('domain')?.trim().toLowerCase();
    if (!domain) return c.text('missing domain', 400);
    const match = await deps.tenantDomains.findByDomain(domain);
    return match ? c.text('ok', 200) : c.text('unknown domain', 404);
  });

  app.post('/internal/backfills/:name', async (c) => {
    const result = await runBackfillBatch(c.req.param('name'), parseLimit(c.req.query('limit')), {
      backfills: deps.backfills,
    });
    if (result.ok) return c.json(result.value, 200);
    return c.json(
      { error: result.error.code, message: result.error.message },
      result.error.code === 'not_found' ? 404 : 500,
    );
  });

  return app;
};

/** Batch size per invocation: default 100, capped at 1000, floored at 1. */
export const parseLimit = (raw: string | undefined): number => {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 100;
  return Math.min(parsed, 1000);
};
