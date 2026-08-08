import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { EXIT_CODE_BY_ERROR_CODE, publicCacheControl } from '#core/contract/index.js';
import { probeSignInCookies } from '#adapters/auth/client-adapter.js';

import { fetchMagicLink } from './mailpit.js';

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
export const run = (
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string = rootDir,
): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
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

const healthSchema = z.object({
  status: z.string(),
  database: z.string(),
  version: z.string(),
  sha: z.string(),
});
const todoItemSchema = z.object({ id: z.string(), title: z.string() });
const todosSchema = z.object({ todos: z.array(todoItemSchema) });
const addSchema = z.object({ todo: todoItemSchema });

const cardItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  board: z.string(),
  column: z.string(),
  position: z.number(),
  visited: z.array(z.string()),
});
const cardsSchema = z.object({ cards: z.array(cardItemSchema) });
const cardWriteSchema = z.object({ card: cardItemSchema });

const memberItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  tags: z.array(z.string()),
});
const membersSchema = z.object({ members: z.array(memberItemSchema) });
const memberEnsureSchema = z.object({ member: memberItemSchema, created: z.boolean() });
const memberExportSchema = z.object({
  exportedAt: z.string(),
  tenantId: z.string(),
  member: memberItemSchema,
});
const memberRemoveSchema = z.object({ memberId: z.string(), deleted: z.object({ members: z.number() }) });

const meSchema = z.object({
  email: z.string(),
  tenant: z.object({ slug: z.string(), memberId: z.string().nullable() }).nullable(),
});
const magicLinkFollowSchema = z.object({ signedIn: z.literal(true), email: z.string() });

const staffItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
});
const staffListSchema = z.object({ staff: z.array(staffItemSchema) });
const staffGrantSchema = z.object({ staff: staffItemSchema, granted: z.boolean() });
const staffRevokeSchema = z.object({ userId: z.string(), revoked: z.number() });

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
const expectError = (
  result: Run,
  label: string,
  exitCode: number,
  errorCode: string,
): { code: string; message: string } => {
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
  return parsed.error;
};

export interface SmokeTarget {
  baseUrl: string;
  email: string;
  password: string;
  tenant: string;
  /** Deploy attestation: when set, health.sha must equal it (right deploy verified). */
  expectedSha?: string;
  /**
   * Mailpit HTTP-API base URL (local/CI only). When set, the magic-link phase
   * requests a link, recovers it from Mailpit and follows it. Absent for
   * `smoke:remote`, where a real relay delivers and there is no capture inbox —
   * the phase is skipped there.
   */
  mailpitApiUrl?: string;
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
  // CSRF/CORS doctrine (architecture §Security baseline): no CORS middleware on
  // the authenticated /api/* surface, so no Access-Control-Allow-Origin may
  // appear. Mounting cors() here would regress the same-origin session boundary.
  const acao = response.headers.get('access-control-allow-origin');
  assert(
    acao === null,
    `authenticated /api/* must not enable CORS, got access-control-allow-origin: "${acao}"`,
  );
};

/**
 * The SPA shell must carry Vercel's revalidate-always default explicitly on
 * self-host (architecture §HTTP caching): hashed assets are immutable, but
 * index.html is served with `public, max-age=0, must-revalidate` so a new
 * deploy is picked up immediately. Parity with the `vercel.json` behaviour.
 */
const assertIndexHtmlCacheHeader = async (baseUrl: string): Promise<void> => {
  const response = await fetch(`${baseUrl}/`);
  assert(response.ok, `GET / (index.html) must serve the SPA shell, got ${response.status}`);
  const cacheControl = response.headers.get('cache-control') ?? '(missing)';
  assert(
    cacheControl === 'public, max-age=0, must-revalidate',
    `index.html cache-control must be "public, max-age=0, must-revalidate" (Vercel revalidate-always parity), got "${cacheControl}"`,
  );
};

/**
 * The session cookie's hardening is the load-bearing half of the CSRF/CORS
 * doctrine (architecture §Security baseline): the primary session boundary is
 * `SameSite=Lax` cookies on a same-origin SPA with **no** CORS middleware on the
 * authenticated `/api/*` surface — so a cross-site page cannot ride the session.
 * Adding `cors()` or relaxing `SameSite` would silently regress that boundary,
 * so we assert the attributes Better Auth actually emits on a live sign-in. The
 * sign-in is a raw POST (not the CLI, which authenticates by bearer token) so
 * the assertion reads the real `Set-Cookie` a browser would receive. `Secure` is
 * required only on https — it is off by design on plaintext `*.localhost` dev.
 */
const assertSessionCookieHardening = async (target: SmokeTarget): Promise<void> => {
  const { baseUrl } = target;
  const probe = await probeSignInCookies(baseUrl, {
    email: target.email,
    password: target.password,
  });
  assert(probe.ok, `sign-in for the cookie assertion failed: ${probe.status} ${probe.body}`);
  const cookies = probe.setCookie;
  const sessionCookie = cookies.find((cookie) => /session_token=/i.test(cookie));
  assert(
    sessionCookie !== undefined,
    `sign-in set no session cookie; Set-Cookie: ${cookies.join(' | ') || '(none)'}`,
  );
  const attributes = sessionCookie.split(';').map((part) => part.trim().toLowerCase());
  assert(attributes.includes('httponly'), `session cookie must be HttpOnly: ${sessionCookie}`);
  assert(
    attributes.includes('samesite=lax'),
    `session cookie must be SameSite=Lax (the CSRF boundary): ${sessionCookie}`,
  );
  const isHttps = new URL(baseUrl).protocol === 'https:';
  assert(
    attributes.includes('secure') === isHttps,
    `session cookie Secure flag must match the transport (https=${isHttps}): ${sessionCookie}`,
  );
};

const publicDiscoverySchema = z.object({ slug: z.string(), contentVersion: z.string() });
const publicProfileSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  contentVersion: z.string(),
});

/**
 * The public contract group (US-028, FR-23/FR-24, §Public surface): unauthenticated
 * GET, open CORS on this prefix ONLY, cacheable via the one shared helper, and
 * content-version-keyed busting. The requests carry a FOREIGN `Origin` header —
 * the curl-from-another-origin CORS proof — and assert `Access-Control-Allow-Origin`
 * is echoed as `*`, while an error stays uncached and the authenticated
 * `/api/health` surface remains CORS-closed under the same foreign Origin.
 */
const assertPublicSurface = async (baseUrl: string, tenant: string): Promise<void> => {
  const foreignOrigin = 'https://someone-elses-site.example';
  const readOk = async (res: Response, label: string): Promise<unknown> => {
    const parsed = envelope.parse(await res.json());
    assert(parsed.ok, `${label}: expected an ok envelope, got an error.`);
    return parsed.data;
  };
  // The Vercel CDN consumes the shared-cache directives at the edge and strips
  // them from the client-visible header, so behind Vercel the literal helper
  // string can never be observed. The platform-appropriate attestation is
  // stronger: the stripped remainder must survive AND a repeat request must be
  // served from the edge cache (x-vercel-cache HIT/STALE) — proof the CDN
  // actually consumed the helper's directives. Direct-to-origin (local smoke,
  // docker-smoke) keeps the literal equality.
  const assertPublicCache = async (
    res: Response,
    profile: Parameters<typeof publicCacheControl>[0],
    refetch: () => Promise<Response>,
    label: string,
  ): Promise<void> => {
    const got = res.headers.get('cache-control');
    if (res.headers.get('x-vercel-id') === null) {
      assert(
        got === publicCacheControl(profile),
        `${label} cache-control must be the ${profile} helper output, got "${got}"`,
      );
      return;
    }
    assert(
      got === 'public, max-age=0',
      `${label} behind the Vercel CDN must keep "public, max-age=0" after edge directives are consumed, got "${got}"`,
    );
    const repeat = await refetch();
    await repeat.arrayBuffer();
    const edge = repeat.headers.get('x-vercel-cache');
    assert(
      edge === 'HIT' || edge === 'STALE',
      `${label} must be edge-cached behind Vercel; expected x-vercel-cache HIT/STALE on a repeat request, got "${edge}"`,
    );
  };

  const discoveryRes = await fetch(`${baseUrl}/api/public/tenants/${tenant}`, {
    headers: { origin: foreignOrigin },
  });
  assert(discoveryRes.status === 200, `public discovery must be 200, got ${discoveryRes.status}`);
  assert(
    discoveryRes.headers.get('access-control-allow-origin') === '*',
    `public discovery must open CORS, got "${discoveryRes.headers.get('access-control-allow-origin')}"`,
  );
  await assertPublicCache(
    discoveryRes,
    'discovery',
    () => fetch(`${baseUrl}/api/public/tenants/${tenant}`, { headers: { origin: foreignOrigin } }),
    'public discovery',
  );
  const discovery = publicDiscoverySchema.parse(await readOk(discoveryRes, 'public discovery'));
  assert(discovery.slug === tenant, `public discovery echoed the wrong slug: ${discovery.slug}`);

  const profileRes = await fetch(
    `${baseUrl}/api/public/tenants/${tenant}/v/${discovery.contentVersion}`,
    { headers: { origin: foreignOrigin } },
  );
  assert(profileRes.status === 200, `public profile must be 200, got ${profileRes.status}`);
  assert(
    profileRes.headers.get('access-control-allow-origin') === '*',
    `public profile must open CORS, got "${profileRes.headers.get('access-control-allow-origin')}"`,
  );
  await assertPublicCache(
    profileRes,
    'profile',
    () =>
      fetch(`${baseUrl}/api/public/tenants/${tenant}/v/${discovery.contentVersion}`, {
        headers: { origin: foreignOrigin },
      }),
    'public profile',
  );
  const profile = publicProfileSchema.parse(await readOk(profileRes, 'public profile'));
  assert(
    profile.slug === tenant && profile.displayName.length > 0,
    `public profile carried the wrong safe fields: ${JSON.stringify(profile)}`,
  );

  const preflight = await fetch(`${baseUrl}/api/public/tenants/${tenant}/v/${discovery.contentVersion}`, {
    method: 'OPTIONS',
    headers: { origin: foreignOrigin, 'access-control-request-method': 'GET' },
  });
  assert(
    preflight.headers.get('access-control-allow-origin') === '*',
    `public CORS preflight must echo the origin as *, got "${preflight.headers.get('access-control-allow-origin')}"`,
  );

  const unknownRes = await fetch(`${baseUrl}/api/public/tenants/ghost-${randomUUID().slice(0, 8)}`, {
    headers: { origin: foreignOrigin },
  });
  assert(unknownRes.status === 404, `unknown public tenant must be 404, got ${unknownRes.status}`);
  assert(
    unknownRes.headers.get('cache-control') === 'no-store',
    `an errored public response must stay no-store, got "${unknownRes.headers.get('cache-control')}"`,
  );
  const unknownBody = envelope.parse(await unknownRes.json());
  assert(!unknownBody.ok, 'unknown public tenant must return an error envelope.');
  assert(
    unknownBody.error.code === 'not_found',
    `unknown public tenant must be not_found, got "${unknownBody.error.code}"`,
  );

  // The separation proof: the SAME foreign Origin against the authenticated
  // surface must NOT enable CORS (architecture §Security baseline).
  const authedRes = await fetch(`${baseUrl}/api/health`, { headers: { origin: foreignOrigin } });
  assert(
    authedRes.headers.get('access-control-allow-origin') === null,
    `authenticated /api/* must stay CORS-closed under a foreign Origin, got "${authedRes.headers.get('access-control-allow-origin')}"`,
  );
};

/**
 * The runtime contract every deploy target must satisfy, driven purely through
 * the CLI: health → sign-in → todos list/add/list → cards add/list/move (→done)
 * (verifying the moved card persists at its new column and index) → the team
 * board (add lands in todo → illegal todo→done rejected with a named rule at
 * exit 2 → the full legal chain todo→in-dev→review→done at exit 0 → list
 * surfaces board + visited) → members (ensure → idempotent re-ensure → list →
 * export → remove, each run creating and removing its own uniquely-emailed
 * member) → staff (FR-8: register a second account → owner grants it admin →
 * idempotent re-grant → the granted user lists todos as admin → admin-cannot-grant
 * (exit 4) → last-owner-revoke blocked (exit 2) → revoke → the revoked user loses
 * tenant access (exit 7), self-cleaning) → unauthorized (exit 3), plus the
 * security/caching response headers and the session-cookie hardening assertion.
 *
 * Non-self-poisoning property (architecture §Environments, smoke-account
 * doctrine): every card this run creates is parked in an **unbounded** column
 * (`done` on both boards — absent from `TEAM_WIP_LIMITS`) before the run ends, so
 * repeated production runs can never saturate the `in-dev`/`review` WIP limits
 * and turn the deploy gate false-red.
 * `homes` collects the temp HOME dirs so the caller can clean them up.
 */
export const driveCli = async (target: SmokeTarget, homes: string[]): Promise<void> => {
  const { baseUrl } = target;
  await assertResponseHeaders(baseUrl);
  await assertIndexHtmlCacheHeader(baseUrl);
  await assertSessionCookieHardening(target);
  await assertPublicSurface(baseUrl, target.tenant);
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
  // Deploy attestation: prove this smoke ran against the exact commit the deploy
  // event carried, closing the "smoke verified the wrong deployment" class.
  if (target.expectedSha !== undefined) {
    assert(
      health.sha === target.expectedSha,
      `health SHA mismatch: expected ${target.expectedSha}, deployment reports ${health.sha}`,
    );
  }

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

  const cardTitle = `smoke card ${randomUUID()}`;
  const addedCard = cardWriteSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'add', '--column', 'doing', cardTitle],
        authedHome,
      ),
      'card add',
    ),
  );
  assert(
    addedCard.card.title === cardTitle && addedCard.card.column === 'doing',
    `card add echoed the wrong card: ${JSON.stringify(addedCard.card)}`,
  );

  const cardsAfterAdd = cardsSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'list'], authedHome),
      'card list (after add)',
    ),
  );
  assert(
    cardsAfterAdd.cards.some((card) => card.id === addedCard.card.id && card.column === 'doing'),
    'the added card did not appear in "doing" in the card list',
  );

  const movedCard = cardWriteSchema.parse(
    expectOk(
      await cli(
        [
          '--json',
          '--api-url',
          baseUrl,
          '--tenant',
          target.tenant,
          'card',
          'move',
          addedCard.card.id,
          '--to',
          'todo',
          '--index',
          '0',
        ],
        authedHome,
      ),
      'card move',
    ),
  );
  assert(
    movedCard.card.column === 'todo' && movedCard.card.position === 0,
    `card move did not land at todo#0: ${JSON.stringify(movedCard.card)}`,
  );

  const cardsAfterMove = cardsSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'list'], authedHome),
      'card list (after move)',
    ),
  );
  const persisted = cardsAfterMove.cards.find((card) => card.id === addedCard.card.id);
  assert(persisted !== undefined, 'the moved card vanished from the card list');
  assert(
    persisted.column === 'todo' && persisted.position === 0,
    `the moved card did not persist at todo#0: ${JSON.stringify(persisted)}`,
  );

  // Park the personal card in `done` (unbounded — the personal board has no WIP
  // limits) so this run leaves nothing that a later run's WIP guard could trip.
  const parkedCard = cardWriteSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'move', addedCard.card.id, '--to', 'done'],
        authedHome,
      ),
      'personal card move to done',
    ),
  );
  assert(
    parkedCard.card.column === 'done',
    `personal card did not park in done: ${JSON.stringify(parkedCard.card)}`,
  );

  // --- team board: ordered columns + WIP limits, enforced server-side ---
  const teamTitle = `smoke team ${randomUUID()}`;
  const teamCard = cardWriteSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'add', '--board', 'team', teamTitle],
        authedHome,
      ),
      'team card add',
    ),
  );
  assert(
    teamCard.card.board === 'team' &&
      teamCard.card.column === 'todo' &&
      teamCard.card.visited.includes('todo'),
    `team card add did not land in todo on the team board: ${JSON.stringify(teamCard.card)}`,
  );

  // Illegal: todo -> done skips the ordered path — rejected (validation, exit 2), rule named.
  const rejected = expectError(
    await cli(
      [
        '--json',
        '--api-url',
        baseUrl,
        '--tenant',
        target.tenant,
        'card',
        'move',
        teamCard.card.id,
        '--board',
        'team',
        '--to',
        'done',
      ],
      authedHome,
    ),
    'illegal team move todo->done',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );
  assert(
    rejected.message.includes('rule'),
    `illegal team move did not name the broken rule: ${rejected.message}`,
  );

  // Legal: walk the full ordered chain todo -> in-dev -> review -> done (exit 0
  // each). The run leaves the card in `done`, which is absent from
  // TEAM_WIP_LIMITS (unbounded), so repeated production runs never accumulate in
  // the bounded `in-dev`/`review` columns and can never trip a WIP guard.
  const teamMove = async (to: string, label: string): Promise<void> => {
    const moved = cardWriteSchema.parse(
      expectOk(
        await cli(
          ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'move', teamCard.card.id, '--board', 'team', '--to', to],
          authedHome,
        ),
        label,
      ),
    );
    assert(moved.card.column === to, `${label} did not land in ${to}: ${JSON.stringify(moved.card)}`);
  };
  await teamMove('in-dev', 'legal team move todo->in-dev');
  await teamMove('review', 'legal team move in-dev->review');
  await teamMove('done', 'legal team move review->done');

  const teamCards = cardsSchema.parse(
    expectOk(
      await cli(
        ['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'card', 'list', '--board', 'team'],
        authedHome,
      ),
      'team card list',
    ),
  );
  const teamPersisted = teamCards.cards.find((card) => card.id === teamCard.card.id);
  assert(teamPersisted !== undefined, 'the team card vanished from the team board list');
  assert(
    teamPersisted.board === 'team' &&
      teamPersisted.column === 'done' &&
      ['todo', 'in-dev', 'review'].every((column) => teamPersisted.visited.includes(column)),
    `team card list did not surface board/visited correctly: ${JSON.stringify(teamPersisted)}`,
  );

  // --- members: the staff-managed end-customer roster (ensure→list→export→remove) ---
  // Self-contained and non-self-poisoning: each run ensures a uniquely-emailed
  // member and removes it before finishing, so repeated production runs leave the
  // roster exactly as they found it.
  const memberArgs = (...args: string[]): string[] => [
    '--json',
    '--api-url',
    baseUrl,
    '--tenant',
    target.tenant,
    'member',
    ...args,
  ];
  const memberEmail = `smoke-${randomUUID()}@example.com`;

  const ensured = memberEnsureSchema.parse(
    expectOk(
      await cli(memberArgs('ensure', memberEmail, '--name', 'Smoke Member', '--tag', 'smoke'), authedHome),
      'member ensure',
    ),
  );
  assert(
    ensured.created && ensured.member.email === memberEmail,
    `member ensure did not create ${memberEmail}: ${JSON.stringify(ensured)}`,
  );

  const reEnsured = memberEnsureSchema.parse(
    expectOk(await cli(memberArgs('ensure', memberEmail), authedHome), 'member ensure (idempotent)'),
  );
  assert(
    !reEnsured.created && reEnsured.member.id === ensured.member.id,
    `member ensure was not idempotent by (tenant, email): ${JSON.stringify(reEnsured)}`,
  );

  const memberList = membersSchema.parse(
    expectOk(await cli(memberArgs('list'), authedHome), 'member list'),
  );
  assert(
    memberList.members.some((m) => m.id === ensured.member.id),
    'the ensured member did not appear in the member list',
  );

  const exported = memberExportSchema.parse(
    expectOk(await cli(memberArgs('export', ensured.member.id), authedHome), 'member export'),
  );
  assert(
    exported.member.email === memberEmail && exported.tenantId.length > 0,
    `member export dumped the wrong member: ${JSON.stringify(exported)}`,
  );

  const removed = memberRemoveSchema.parse(
    expectOk(await cli(memberArgs('remove', ensured.member.id), authedHome), 'member remove'),
  );
  assert(
    removed.memberId === ensured.member.id && removed.deleted.members === 1,
    `member remove did not report the cascade: ${JSON.stringify(removed)}`,
  );

  const afterRemove = membersSchema.parse(
    expectOk(await cli(memberArgs('list'), authedHome), 'member list (after remove)'),
  );
  assert(
    !afterRemove.members.some((m) => m.id === ensured.member.id),
    'the removed member is still present in the roster',
  );

  // --- magic link + member binding (US-026): provision a member, sign them in
  // via a passwordless magic link, and prove the provisioned (null userId) member
  // row is claimed on first sign-in. The real smtp adapter delivers to a local
  // Mailpit (no dev transport); the link is recovered over Mailpit's HTTP API and
  // followed, exactly as a human would from the inbox. Skipped for smoke:remote
  // (a real relay delivers there, no capture inbox). Self-cleaning: the
  // provisioned member is removed before finishing; the magic sign-in creates one
  // account (unique email) as the only residue.
  if (target.mailpitApiUrl !== undefined) {
    const mailpitApiUrl = target.mailpitApiUrl;
    const magicEmail = `smoke-magic-${randomUUID()}@example.com`;
    const magicHome = mkdtempSync(join(tmpdir(), 'smoke-magic-'));
    homes.push(magicHome);

    const provisioned = memberEnsureSchema.parse(
      expectOk(await cli(memberArgs('ensure', magicEmail, '--name', 'Magic Smoke'), authedHome), 'magic member ensure'),
    );
    assert(
      provisioned.created && provisioned.member.email === magicEmail,
      `magic member was not provisioned: ${JSON.stringify(provisioned)}`,
    );

    expectOk(
      await cli(['--json', '--api-url', baseUrl, 'login-link', '--email', magicEmail], magicHome),
      'magic link request',
    );
    const link = await fetchMagicLink(mailpitApiUrl, magicEmail);
    const followed = magicLinkFollowSchema.parse(
      expectOk(
        await cli(['--json', '--api-url', baseUrl, 'login-link', '--email', magicEmail, '--link', link], magicHome),
        'magic link follow',
      ),
    );
    assert(followed.email === magicEmail, `magic link signed in the wrong email: ${followed.email}`);

    const magicMe = meSchema.parse(
      expectOk(
        await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'whoami'], magicHome),
        'magic whoami',
      ),
    );
    assert(
      magicMe.email === magicEmail &&
        magicMe.tenant?.slug === target.tenant &&
        magicMe.tenant?.memberId === provisioned.member.id,
      `magic-link sign-in did not bind the provisioned member: ${JSON.stringify(magicMe)}`,
    );

    expectOk(await cli(memberArgs('remove', provisioned.member.id), authedHome), 'magic member cleanup');
  }

  // --- staff (FR-8): owner grants a second REGISTERED user admin, then revokes ---
  // Self-cleaning: the grant is revoked before the run ends, so tenant_admins is
  // left as found. The second account is registered under a unique email (FR-8
  // grants an account that must ALREADY exist — no invitations) and is the only
  // residue; it holds no access after the revoke.
  const adminHome = mkdtempSync(join(tmpdir(), 'smoke-admin-'));
  homes.push(adminHome);
  const adminEmail = `smoke-admin-${randomUUID()}@example.com`;
  const staffArgs = (...args: string[]): string[] => [
    '--json',
    '--api-url',
    baseUrl,
    '--tenant',
    target.tenant,
    'staff',
    ...args,
  ];

  expectOk(
    await cli(
      ['--json', '--api-url', baseUrl, 'register', '--name', 'Smoke Admin', '--email', adminEmail, '--password', 'smoke-admin-1234'],
      adminHome,
    ),
    'register second user',
  );

  // Granting an email with no account is refused (no invitations, exit 5).
  expectError(
    await cli(staffArgs('grant', `nobody-${randomUUID()}@example.com`), authedHome),
    'staff grant unknown email',
    EXIT_CODE_BY_ERROR_CODE.not_found,
    'not_found',
  );

  const granted = staffGrantSchema.parse(expectOk(await cli(staffArgs('grant', adminEmail), authedHome), 'staff grant'));
  assert(
    granted.granted && granted.staff.role === 'admin' && granted.staff.email === adminEmail,
    `staff grant did not create the admin: ${JSON.stringify(granted)}`,
  );

  const reGranted = staffGrantSchema.parse(
    expectOk(await cli(staffArgs('grant', adminEmail), authedHome), 'staff grant (idempotent)'),
  );
  assert(!reGranted.granted, `staff grant was not idempotent on re-grant: ${JSON.stringify(reGranted)}`);

  const roster = staffListSchema.parse(expectOk(await cli(staffArgs('list'), authedHome), 'staff list'));
  assert(
    roster.staff.some((s) => s.email === adminEmail && s.role === 'admin') &&
      roster.staff.some((s) => s.role === 'owner'),
    `staff list did not surface the owner + new admin: ${JSON.stringify(roster.staff)}`,
  );

  // The granted user can now act as admin: list todos in the tenant.
  expectOk(
    await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], adminHome),
    'granted admin lists todos',
  );

  // Granting is owner-only: the admin is forbidden (exit 4).
  expectError(
    await cli(staffArgs('grant', adminEmail), adminHome),
    'admin cannot grant (owner-only)',
    EXIT_CODE_BY_ERROR_CODE.forbidden,
    'forbidden',
  );

  // Lockout guard: the sole owner cannot revoke themselves (validation, exit 2).
  expectError(
    await cli(staffArgs('revoke', '--email', target.email), authedHome),
    'last-owner revoke blocked',
    EXIT_CODE_BY_ERROR_CODE.validation,
    'validation',
  );

  const revoked = staffRevokeSchema.parse(
    expectOk(await cli(staffArgs('revoke', '--email', adminEmail), authedHome), 'staff revoke'),
  );
  assert(revoked.revoked === 1, `staff revoke did not remove exactly one grant: ${JSON.stringify(revoked)}`);

  // After revocation the user is neither staff nor a member, so tenant resolution
  // denies the request before any use-case runs (tenant_not_found, exit 7) — the
  // membership check is upstream of authorization.
  expectError(
    await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], adminHome),
    'revoked admin loses tenant access',
    EXIT_CODE_BY_ERROR_CODE.tenant_not_found,
    'tenant_not_found',
  );

  // Public surface via the CLI with NO session: anonHome holds no token, so
  // `public profile` proves the group is reachable unauthenticated (US-028).
  const publicProfile = publicProfileSchema.parse(
    expectOk(
      await cli(['--json', '--api-url', baseUrl, 'public', 'profile', target.tenant], anonHome),
      'public profile (no session)',
    ),
  );
  assert(
    publicProfile.slug === target.tenant && publicProfile.displayName.length > 0,
    `CLI public profile echoed the wrong safe fields: ${JSON.stringify(publicProfile)}`,
  );

  expectError(
    await cli(['--json', '--api-url', baseUrl, '--tenant', target.tenant, 'todo', 'list'], anonHome),
    'unauthorized todo list',
    EXIT_CODE_BY_ERROR_CODE.unauthorized,
    'unauthorized',
  );
};
