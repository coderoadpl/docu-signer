import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { warnIfDistStale } from './dist-freshness.js';
import { loadEnv } from './env.js';
import { buildInternalApp } from './internal-app.js';
import { startServerObservability } from './observability.js';

startServerObservability();

const env = loadEnv();
const deps = createDeps(env);
const app = buildApp(deps);

warnIfDistStale(env.WEB_DIST_DIR, process.cwd());

// Same process serves the SPA build — one origin per tenant domain, no CORS.
// Cache parity with the Vercel headers block (architecture §HTTP caching):
// hashed assets are immutable; index.html carries Vercel's revalidate-always
// default explicitly so a new deploy is picked up immediately on self-host too.
const INDEX_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
app.use(
  '*',
  serveStatic({
    root: env.WEB_DIST_DIR,
    onFound: (path, c) => {
      c.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : INDEX_CACHE_CONTROL,
      );
    },
  }),
);
app.get(
  '*',
  serveStatic({
    path: `${env.WEB_DIST_DIR}/index.html`,
    onFound: (_path, c) => {
      c.header('cache-control', INDEX_CACHE_CONTROL);
    },
  }),
);

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`agentproofarch listening on http://localhost:${info.port}`);
});

// Self-host control plane: the domain-check surface Caddy's on-demand TLS asks,
// on its own port reachable only on the compose container network (never
// published). Starts only when INTERNAL_PORT is set — dev/smoke/e2e/Vercel don't
// set it, so this endpoint exists on the self-host target alone.
if (env.INTERNAL_PORT !== undefined) {
  serve({ fetch: buildInternalApp(deps).fetch, port: env.INTERNAL_PORT, hostname: '0.0.0.0' }, (info) => {
    console.log(`agentproofarch internal control plane on :${info.port}`);
  });
}
