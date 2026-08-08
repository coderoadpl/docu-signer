/**
 * Before the `name: agentproofarch-dev` rename in docker-compose.dev.yml the
 * Compose project was derived from the directory (usually `demo`), so an
 * existing checkout can still own port 47542 and the old dev volume. Starting
 * the renamed stack next to it would fail on the port or silently detach the
 * reader from their data — refuse with the migration remedy instead.
 */
import { spawnSync } from 'node:child_process';

const LEGACY_PROJECT = 'demo';
const dbPort = process.env['DB_PORT'] ?? '47542';

const probe = spawnSync('docker', [
  'ps',
  '--filter',
  `label=com.docker.compose.project=${LEGACY_PROJECT}`,
  '--filter',
  `publish=${dbPort}`,
  '--format',
  '{{.Names}}',
]);

if (probe.status === 0) {
  const holders = probe.stdout.toString().trim();
  if (holders !== '') {
    console.error(
      `db:up: the legacy "${LEGACY_PROJECT}" Compose project (${holders}) still holds port ${dbPort}.\n` +
        `It predates the shared agentproofarch-dev stack; its volume holds disposable dev seed data.\n` +
        `Retire it, then start the new stack:\n` +
        `  docker compose -p ${LEGACY_PROJECT} down -v\n` +
        `  pnpm run db:up && pnpm run db:migrate && pnpm run db:seed`,
    );
    process.exit(1);
  }
}
