import type { IncomingMessage, ServerResponse } from 'node:http';

import { handle } from '@hono/node-server/vercel';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { loadEnv } from '../apps/server/src/env.js';
import { startServerObservability } from '../apps/server/src/observability.js';

// Contain the vendor name at the platform boundary (architecture §Layers:
// provider names live only in adapters and this platform entry). The app reads
// the neutral APP_COMMIT_SHA; Vercel injects VERCEL_GIT_COMMIT_SHA per deploy.
process.env.APP_COMMIT_SHA ??= process.env.VERCEL_GIT_COMMIT_SHA;

const flush = startServerObservability();
const app = buildApp(createDeps(loadEnv()));
const handler = handle(app);

// Requires NODEJS_HELPERS=0 on the Vercel project: with helpers on, the
// runtime drains the request stream to parse req.body and every POST hangs
// waiting for a body that never arrives. With helpers off this is the plain
// node-style (req, res) contract; keep the explicit two-parameter signature.
export default async function nodeHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await handler(req, res);
  } finally {
    if (flush) await flush();
  }
}
