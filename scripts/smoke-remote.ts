import { rmSync } from 'node:fs';

import { driveCli, SmokeFailure } from './smoke-cli.js';

const baseUrl = process.env['BASE_URL'];
if (!baseUrl) {
  console.error('smoke:remote: FAIL\nBASE_URL is required (the deployment URL, e.g. https://app.vercel.app)');
  process.exit(2);
}
const email = process.env['SMOKE_EMAIL'] ?? 'demo@agentproofarch.dev';
const password = process.env['SMOKE_PASSWORD'] ?? 'demo1234';
const tenant = process.env['SMOKE_TENANT'] ?? 'acme';
// When CI passes the deployment SHA, assert the live health SHA equals it so a
// smoke run can never green-light a deployment other than the one that triggered it.
const expectedSha = process.env['EXPECTED_SHA'] || undefined;

const startedAt = Date.now();
const homes: string[] = [];
try {
  console.log(`smoke:remote: driving the CLI against ${baseUrl}...`);
  await driveCli({ baseUrl, email, password, tenant, ...(expectedSha ? { expectedSha } : {}) }, homes);
  console.log(`\nsmoke:remote: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof SmokeFailure ? error.message : String(error);
  console.error(`\nsmoke:remote: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  for (const dir of homes) rmSync(dir, { recursive: true, force: true });
}
