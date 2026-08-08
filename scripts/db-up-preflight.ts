import { spawnSync } from 'node:child_process';

const currentProject = 'podpisy-dev';
const dbPort = process.env['DB_PORT'] ?? '47542';

// WHY: Pre-rename checkouts created directory-named projects that can keep the shared port occupied.
const probe = spawnSync('docker', [
  'ps',
  '--filter',
  `publish=${dbPort}`,
  '--format',
  '{{.Label "com.docker.compose.project"}}\t{{.Names}}',
]);

if (probe.status === 0) {
  const projects = new Map<string, string[]>();
  for (const line of probe.stdout.toString().trim().split('\n')) {
    if (line === '') continue;
    const [project = '', container = ''] = line.split('\t');
    if (project === '' || project === currentProject) continue;
    projects.set(project, [...(projects.get(project) ?? []), container]);
  }
  if (projects.size > 0) {
    const details = [...projects]
      .map(
        ([project, containers]) =>
          `db:up: Compose project "${project}" (${containers.join(', ')}) holds port ${dbPort}.\n` +
          `Run this exact command, then retry:\n` +
          `  docker compose -p ${project} down`,
      )
      .join('\n\n');
    console.error(
      `${details}\n\nAfter stopping the old project, run:\n` +
        `  pnpm run db:up && pnpm run db:migrate && pnpm run db:seed`,
    );
    process.exit(1);
  }
}
