# agentproofarch — rules for agents

Architecture spec: `../docs/prd-agentproofarch-foundation.md` (see also `../docs/architecture.md`) (§3 is normative).

## The two gates

- `npm run check` = typecheck + ESLint (boundaries) + lock-lint (validates
  package-lock.json under npm 10 semantics, exactly what `npm ci` on the
  node-22 CI runner enforces — a local npm 11 `npm install` silently prunes
  optional entries npm 10 requires, which broke CI twice) + dependency-cruiser +
  doc-lint (docs↔config enforcer coverage) + vitest with `--coverage` — the
  **static** gate; coverage thresholds are a ratchet floor (measured minimum
  rounded down, per-metric) enforced here, so a coverage regression fails
  `npm run check`.
- `npm run smoke` = the **runtime** gate: it verifies the installed dependency
  tree matches `package-lock.json`, drops+recreates an isolated
  `agentproofarch_smoke` database (never touches your dev-seeded data), migrates
  and seeds it, boots the real server (`entry.node.ts`) on an ephemeral port and
  drives health → sign-in → todos through the CLI, asserting taxonomy exit codes
  (including unauthorized = exit 3). Assumes `npm run db:up`. Runs in ~5s.
  Integration tests (`npm run test:integration`, opt-in `VITEST_INTEGRATION=1`)
  run where Postgres exists — the CI smoke job runs them before smoke — so local
  `npm run smoke` stays fast.

**Done = `check` green AND `smoke` green.** Static-green is not done; the app
must actually run. Do not weaken lint rules to make either green.

- `npm run e2e` = the **browser** gate: Playwright drives a real Chromium over
  the real stack (isolated `agentproofarch_e2e` DB, `localhost` registered as a
  single-tenant custom domain, `entry.node.ts` serving the built bundle) through
  login → seeded todos → add-todo → failed-login → cache headers. It needs a
  browser and Postgres, so it is its own CI job (`e2e`), never part of `check`.

## Layer rules (enforced, but know them anyway)

- `core/**` is pure TypeScript: no hono, react, drizzle, better-auth, pg, commander.
- `core/domain` depends on zod only. `core/server` = use-cases + ports.
  `core/contract` = the only bridge between server and clients.
  `core/client` = the only way any client talks HTTP.
- `adapters/**` implement ports; only `apps/server/src/composition.ts` instantiates them.
- `apps/web` and `apps/cli` import `core/client` (+ auth client adapter), never
  `core/server`, never `adapters/db`.
- `@vercel/*` / `@neondatabase/*` only inside `adapters/` (and `entry.vercel.ts`).
- No `any`. No `as` (except `as const`). Parse with zod at every boundary.
- Use-cases return `Result<T, AppError>`; never throw across a boundary.
  New error kinds go into `ERROR_CODES` in `core/domain/errors.ts` and get an
  HTTP status + exit code mapping in `core/contract/http-status.ts` (exhaustive).
- Every tenant-scoped use-case takes `ctx: { identity }` first; every
  tenant-scoped repository method requires `tenantId`.

## Verify features through the CLI first

```bash
npm run db:up && npm run db:migrate && npm run db:seed
npm run dev:server &          # port 47100
npm run --silent cli -- --json health
npm run --silent cli -- login --email demo@agentproofarch.dev --password demo1234
npm run --silent cli -- --tenant acme todo list
```

`--json` prints exactly one JSON envelope on stdout; exit codes come from
`EXIT_CODE_BY_ERROR_CODE`. Adding a resource = domain schema → contract route →
port + use-case → adapter repo → server route → `core/client` method →
CLI command → web page, in that order, with tests at the core layer.

Start every new resource with the scaffolder — it is the canonical entry point:
`npm run new:resource -- <singular-name>` (e.g. `blog-post`). It generates the
files a resource owns outright (domain type, use-cases + test, repository, web
page + route) and prints an ordered checklist for the shared files you must wire
by hand, each with its anchor line and a paste-ready snippet. It deliberately
does **not** edit shared files: the generated code imports symbols that don't
exist yet, so `npm run check` stays RED until every checklist step is wired —
the type system, not the generator, enforces completion.

## Dev notes

- **Frontend work goes through `npm run dev:web`** (Vite on 47180, hot reload) —
  that is the canonical dev path. `npm run dev:server` serves whatever `dist/web`
  holds, which is a gitignored build: after a contract change an old bundle fails
  every page with "response does not match the contract" (incident 2026-07-12).
  The server warns at boot when `dist/web` is missing or older than the
  web/contract sources; on that warning run `npm run build:web` or switch to
  `dev:web`.
- Ports: API 47100, Vite dev 47180, Postgres 47542 (never 3000/8080/5432).
- Tenants live on subdomains: `acme.localhost:47100`. Browsers reject
  `Domain=.localhost` cookies → per-subdomain login in dev only.
- Better Auth CSRF requires an `Origin` header on auth POSTs (CLI sends its API URL).
- Seed is idempotent; demo credentials `demo@agentproofarch.dev` / `demo1234`.
