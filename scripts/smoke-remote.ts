import { rmSync } from 'node:fs';

import { driveCli, SmokeFailure } from './smoke-cli.js';
import { remoteSmokeTargetFromEnv } from './smoke-target.js';

const baseUrl = process.env['BASE_URL'];
if (!baseUrl) {
  console.error('smoke:remote: FAIL\nBASE_URL is required (the deployment URL, e.g. https://app.vercel.app)');
  process.exit(2);
}
const target = remoteSmokeTargetFromEnv(baseUrl, process.env);

const startedAt = Date.now();
const homes: string[] = [];
try {
  console.log(`smoke:remote: driving the CLI against ${baseUrl}...`);
  if (target.anonymousOnly === true) {
    console.log(
      'smoke:remote: no SMOKE_EMAIL — unauthenticated surface only (headers, public API, health, attestation); set SMOKE_EMAIL/SMOKE_PASSWORD/SMOKE_TENANT for the full canary drive',
    );
  }
  await driveCli(target, homes);
  console.log(`\nsmoke:remote: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke:remote: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
}
