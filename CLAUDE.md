# agentproofarch — rules for agents

Architecture spec: `../docs/prd-agentproofarch-foundation.md` (see also `../docs/architecture.md`) (§3 is normative).

## The two gates

- `pnpm run check` = typecheck + ESLint (boundaries) + lock-lint (proves
  `pnpm-lock.yaml` matches `package.json` with the same frozen-lockfile
  semantics as the Node 24 CI runner) + dependency-cruiser +
  knip (dead files + dependency hygiene; unused exports/types stay advisory
  during the PRD build-out — see `knip.jsonc`) +
  doc-lint (docs↔config enforcer coverage, injected count tokens, env-schema ⊆
  `.env.example`, dead relative links) + vitest with `--coverage` — the
  **static** gate; coverage thresholds are a ratchet floor (measured minimum
  rounded down, per-metric) enforced here, so a coverage regression fails
  `pnpm run check`.
- `pnpm run smoke` = the **runtime** gate: it verifies the installed dependency
  tree matches `pnpm-lock.yaml`, drops+recreates an isolated
  `agentproofarch_smoke` database (never touches your dev-seeded data), migrates
  and seeds it, boots the real server (`entry.node.ts`) on an ephemeral port and
  drives health → sign-in → todos through the CLI, asserting taxonomy exit codes
  (including unauthorized = exit 3). Assumes `pnpm run db:up`. Runs in a few
  seconds warm; a first run can take ~20-30s.
  Integration tests (`pnpm run test:integration`, opt-in `VITEST_INTEGRATION=1`)
  run where Postgres exists — the CI smoke job runs them before smoke — so local
  `pnpm run smoke` stays fast.

**Done = `check` green AND `smoke` green.** Static-green is not done; the app
must actually run. Do not weaken lint rules to make either green.

The toolchain is pinned by `.nvmrc` and `engines.node` (Node 24),
`engines.pnpm` (`>=10`) and `packageManager` (`pnpm@10.34.5`). Run `nvm use`,
then `corepack enable && corepack prepare --activate`, before installing. Use
`pnpm add` for dependencies and commit the settled lockfile.

pnpm blocks dependency lifecycle scripts unless a package is named in
`pnpm-workspace.yaml`'s `onlyBuiltDependencies`; keep that allowlist minimal and
add an entry only when a gate demonstrably fails without it. The same config
sets `minimumReleaseAge: 4320`, so releases cool down for three days before they
can be resolved. Every immutable install path uses
`pnpm install --frozen-lockfile`; a missing or stale lockfile is a hard failure.

**Flake doctrine (owner ruling 2026-07-20, DECIDE F3): the gates are
deterministic; a flake is a P1 bug, never rerun-to-green.** A red gate means
the commit is wrong or the gate is wrong — one of them gets fixed; rerunning a
red CI job until it passes is prohibited. Playwright keeps `retries: 1`
(`trace: 'on-first-retry'` is the diagnostic capture), but any run where the
retry is what turned it green is flaky-flagged and requires a **filed P1**
before merging. (Enforcement — TYPE/LINT: n/a, flakiness is not syntactic ·
TEST: the retry-plus-trace config itself surfaces and records every flake ·
REVIEW+AI: the PR-template line; a rerun-to-green merge without a filed P1 is
rejected.)

- `pnpm run e2e` = the **browser** gate: Playwright drives a real Chromium over
  the real stack (isolated `agentproofarch_e2e` DB, `localhost` registered as a
  single-tenant custom domain, `entry.node.ts` serving the built bundle) across
  three spec files (9 tests): `app.spec.ts` (login → seeded todos → add-todo →
  failed-login → cache headers → liveness/readiness → anonymous redirect to
  login), `board.spec.ts` (the personal board: add,
  reorder, persist across reload, move across columns, undo) and
  `team-board.spec.ts` (the team board: entry-column-only, the WIP guard
  blocking and releasing, and a legal chain persisting). The harness boots the
  server with `AUTH_RATE_LIMIT: 'off'` (`scripts/e2e-server.ts`) — the baseline
  is on (including dev), but the specs replay many logins that would otherwise
  trip the limiter and flake the run. It needs a browser and Postgres, so it is
  its own CI job (`e2e`), never part of `check`.

- `pnpm run visual` = the **pixel** check
  ([ADR-0008](../docs/decisions/0008-visual-regression.md)): Playwright
  `toHaveScreenshot()` over the same boot harness, in its own suite
  (`visual/`, `playwright.visual.config.ts`) so a moved screenshot can never
  redden `e2e`. It is **not a required check** — the required set is
  `check`/`smoke`/`e2e`/`docker-smoke` (+ `ai-review` on `main-gates`), and
  `visual` stays out of it until the owner arms it. Baselines
  (`visual/__screenshots__/<platform>/`) are rendered by the linux CI runner via
  the `visual-baselines` workflow and committed; a mac run compares nothing
  (`ignoreSnapshots`), so it can neither author nor overwrite them. Changing the
  UI on purpose means dispatching `visual-baselines` with `update: true` and
  committing the new PNGs in the same PR.

## Layer rules (enforced, but know them anyway)

Per-layer one-screen summaries live beside the code — [`core/CLAUDE.md`](core/CLAUDE.md), [`adapters/CLAUDE.md`](adapters/CLAUDE.md), [`apps/CLAUDE.md`](apps/CLAUDE.md) (each with `AGENTS.md` symlink) — read the one for the layer you are editing.

- `core/**` is pure TypeScript: no hono, react, drizzle, better-auth, pg, commander.
- `core/domain` depends on zod only. `core/server` = use-cases + ports.
  `core/contract` = the only bridge between server and clients.
  `core/client` = the only way any client talks HTTP.
- `adapters/**` implement ports; only `apps/server/src/composition.ts`
  instantiates a *server* adapter. Two deliberate exceptions: the auth *client*
  adapter is constructed in `apps/web/src/api.ts` (web) and the CLI's `cliCtx`,
  and `adapters/db/migrate.ts` reads `DB_DRIVER`/`DATABASE_URL`/`VERCEL` itself
  as a sanctioned composition point outside the server root.
- `apps/web` and `apps/cli` import `core/client` (+ auth client adapter), never
  `core/server`, never `adapters/db`.
- `@vercel/*` / `@neondatabase/*` only inside `adapters/` (and the platform
  entry `api/index.ts`).
- No `any`. No `as` (except `as const`). Parse with zod at every boundary.
- Use-cases return `Result<T, AppError>` for domain errors; they do not catch
  infrastructure rejections (a thrown port promise) — those are normalized once
  at the composition edge (`app.onError`).
  New error kinds go into `ERROR_CODES` in `core/domain/errors.ts` and get an
  HTTP status + exit code mapping in `core/contract/http-status.ts` (exhaustive).
- Every tenant-scoped use-case takes `ctx: { identity }` first; every
  tenant-scoped repository method requires `tenantId`.
- Every tenant-scoped use-case authorizes FIRST — its opening statement is the
  capability predicate (`authorize` / `authorizeTenant` from `core/server`,
  default-deny; see `../docs/architecture.md` §Authorization) — before any
  repository access; a self-scoped read that carries no capability (e.g.
  `listMyTenants`) is the only exception and is a reasoned allowlist entry.

## Verify features through the CLI first

```bash
pnpm run db:up && pnpm run db:migrate && pnpm run db:seed
pnpm run dev:server &          # port 47100
pnpm --silent run cli --json health
pnpm --silent run cli login --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli --tenant acme todo list
```

`--json` prints exactly one JSON envelope on stdout; exit codes come from
`EXIT_CODE_BY_ERROR_CODE`. Adding a resource walks a 12-step chain: domain →
contract → port → use-case index → adapter schema → composition → server routes
→ client → client queries → CLI → web binding → web route, in that order, with
tests at the core layer.

Client state follows the island-core model (`../docs/architecture.md`
§Client application state, ADR-0005): a feature's `core/` is pure TS —
events in, selectors out — with lint-enforced purity; scaffold a new island
with `pnpm run new:island -- <name>`. How a core graduates rungs is read off
the two living boards in `../docs/island-graduation.md`.

Start every new resource with the scaffolder — it is the canonical entry point:
`pnpm run new:resource -- <singular-name>` (e.g. `blog-post`). It generates the
files a resource owns outright (domain type, use-cases + test, repository, web
page + route) and prints an ordered checklist for the shared files you must wire
by hand, each with its anchor line and a paste-ready snippet. It deliberately
does **not** edit shared files: the generated code imports symbols that don't
exist yet, so `pnpm run check` stays RED through the type-forced steps (domain,
contract, port/use-case, client wiring). Three steps are **not** type-forced — a
missing CLI command, an unregistered web route, and a hand-registered server
route (routes are wired by hand against `API_PATHS`, with no parity check) all
typecheck fine — so `check` can go green with those still unwired; the checklist,
not the compiler, is what guarantees they are done.

## Dev notes

- **Frontend work goes through `pnpm run dev:web`** (Vite on 47180, hot reload) —
  that is the canonical dev path. `pnpm run dev:server` serves whatever `dist/web`
  holds, which is a gitignored build: after a contract change an old bundle fails
  every page with "response does not match the contract" (incident 2026-07-12).
  The server warns at boot when `dist/web` is missing or older than the
  web/contract sources; on that warning run `pnpm run build:web` or switch to
  `dev:web`.
- Ports: API 47100, Vite dev 47180, Postgres 47542 (never 3000/8080/5432).
- Tenants live on subdomains: `acme.localhost:47100`. Browsers reject
  `Domain=.localhost` cookies → per-subdomain login in dev only.
- Better Auth CSRF requires an `Origin` header on auth POSTs (CLI sends its API URL).
- Seed is idempotent; demo credentials `demo@agentproofarch.dev` / `demo1234`.
