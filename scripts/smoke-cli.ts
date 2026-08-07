import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';

export const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const tsxBin = join(rootDir, 'node_modules/.bin/tsx');

export class SmokeFailure extends Error {}
export const fail = (message: string): never => {
  throw new SmokeFailure(message);
};
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}
export const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const okEnvelope = z.object({ ok: z.literal(true), data: z.unknown() });
const errEnvelope = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});
const envelope = z.discriminatedUnion('ok', [okEnvelope, errEnvelope]);

const healthSchema = z.object({ status: z.string(), database: z.string(), version: z.string() });
const todoItemSchema = z.object({ id: z.string(), title: z.string() });
const todosSchema = z.object({ todos: z.array(todoItemSchema) });
const addSchema = z.object({ todo: todoItemSchema });

const readEnvelope = (result: Run, label: string): unknown => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(
      `${label}: stdout was not a JSON envelope.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
};
const expectOk = (result: Run, label: string): unknown => {
  assert(
    result.code === 0,
    `${label}: expected exit 0, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = envelope.parse(readEnvelope(result, label));
  assert(parsed.ok, `${label}: expected an ok envelope, got an error.`);
  return parsed.data;
};
const expectError = (result: Run, label: string, exitCode: number, errorCode: string): void => {
  assert(
    result.code === exitCode,
    `${label}: expected exit ${exitCode}, got ${result.code}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  const parsed = envelope.parse(readEnvelope(result, label));
  assert(!parsed.ok, `${label}: expected an error envelope, got ok.`);
  assert(
    parsed.error.code === errorCode,
    `${label}: expected error code "${errorCode}", got "${parsed.error.code}".`,
  );
};

export interface SmokeTarget {
  baseUrl: string;
  email: string;
  password: string;
  tenant: string;
}

/**
 * Security/caching headers are part of the runtime contract (architecture
 * §Security baseline, §HTTP caching): tenant-scoped JSON is never stored by
 * any cache, and the security headers must survive every deploy target.
 */
const assertResponseHeaders = async (baseUrl: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/api/health`);
  const cacheControl = response.headers.get('cache-control') ?? '(missing)';
  assert(
    cacheControl === 'no-store',
    `API cache-control must be "no-store", got "${cacheControl}"`,
  );
  const nosniff = response.headers.get('x-content-type-options') ?? '(missing)';
  assert(nosniff === 'nosniff', `x-content-type-options must be "nosniff", got "${nosniff}"`);
  const csp = response.headers.get('content-security-policy') ?? '(missing)';
  assert(
    csp.includes("script-src 'self'"),
    `content-security-policy must pin script-src 'self', got "${csp}"`,
  );
};

/**
 * The runtime contract every deploy target must satisfy, driven purely through
 * the CLI: health → sign-in → todos list/add/list → unauthorized (exit 3),
 * plus the security/caching response headers.
 * `homes` collects the temp HOME dirs so the caller can clean them up.
 */
export const driveCli = async (target: SmokeTarget, homes: string[]): Promise<void> => {
  const { baseUrl } = target;
  await assertResponseHeaders(baseUrl);
  const authedHome = mkdtempSync(join(tmpdir(), 'smoke-cli-'));
  const anonHome = mkdtempSync(join(tmpdir(), 'smoke-anon-'));
  homes.push(authedHome, anonHome);
  const cli = (args: string[], home: string): Promise<Run> =>
    run(tsxBin, ['apps/cli/src/main.ts', ...args], { HOME: home });

  const health = healthSchema.parse(
    expectOk(await cli(['--json', '--api-url', baseUrl, 'health'], authedHome), 'health'),
  );
  assert(
    health.status === 'ok' && health.database === 'up',
    `health degraded: status=${health.status} database=${health.database}`,
  );

  expectOk(
    await cli(
      ['--json', '--api-url', baseUrl, 'login', '--email', target.email, '--password', target.password],
      authedHome,
    ),
    'login',
  );

  const before = todosSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], authedHome),
      'todo list (before)',
    ),
  );

  const title = `smoke check ${randomUUID()}`;
  const added = addSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'add', title],
        authedHome,
      ),
      'todo add',
    ),
  );
  assert(added.todo.title === title, `todo add echoed the wrong title: ${added.todo.title}`);

  const after = todosSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], authedHome),
      'todo list (after)',
    ),
  );
  assert(
    after.todos.some((todo) => todo.id === added.todo.id),
    'the added todo did not appear in the second list',
  );
  assert(
    after.todos.length === before.todos.length + 1,
    `expected exactly one more todo (${before.todos.length} -> ${after.todos.length})`,
  );

  expectError(
    await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], anonHome),
    'unauthorized todo list',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );
};
