import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { delay, fail, rootDir, SmokeFailure, tsxBin } from './smoke-cli.js';

// The dev/CI Mailpit (docker-compose.dev.yml): the real smtp adapter delivers
// here and the magic-link phase reads the message back over its HTTP API.
export const MAILPIT_SMTP_PORT = 47925;
export const MAILPIT_API_URL = 'http://localhost:47980';

export const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

export const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const { pid } = child;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (pid !== undefined) process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
};

export interface BootTarget {
  port: number;
  databaseUrl: string;
  webDistDir: string;
}

export const bootServer = async ({
  port,
  databaseUrl,
  webDistDir,
}: BootTarget): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: `http://localhost:${port}`,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      // Real smtp transport → the dev/CI Mailpit captures the magic-link send;
      // pinned here so a stray EMAIL_TRANSPORT in the ambient shell can't divert it.
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(MAILPIT_SMTP_PORT),
      SMTP_SECURE: 'false',
    },
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  let exitInfo: string | null = null;
  child.on('exit', (code, signal) => {
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const healthUrl = `http://localhost:${port}/api/health`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      // not accepting connections yet
    }
    await delay(300);
  }
  // A child that never answered health checks still holds its port; reap it
  // before surfacing the failure, or the run leaves an orphan server behind.
  await killServer(child);
  throw new SmokeFailure(
    `Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`,
  );
};
