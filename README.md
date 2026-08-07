# Podpisy

Agent-first, strictly layered full-stack TypeScript foundation for multi-tenant SaaS.
The architecture is defined in [../docs/architecture.md](../docs/architecture.md)
(and distilled from [../docs/prd-agentproofarch-foundation.md](../docs/prd-agentproofarch-foundation.md));
this repo is the **walking skeleton**: auth, organizations (tenants), tenant
resolution by domain, one demo resource (todos) flowing through every layer, a
full CLI and a web SPA. Live at <https://agentproofarch.vercel.app>
(`demo@agentproofarch.dev` / `demo1234`).

New here? Read [../docs/first-feature.md](../docs/first-feature.md) — it adds a
real resource end-to-end in 30 minutes.

## Quickstart (local demo)

```bash
npm ci               # NOT npm install (see "The two gates")
npm run db:up        # Postgres 16 in Docker on port 47542
npm run db:migrate
npm run db:seed      # demo user + two tenants + todos
npm run dev:web      # frontend: Vite + hot reload on 47180 — the canonical dev path
```

`dev:web` is where **all frontend work** happens. For a prod-like page (the
server serving a built bundle instead of the Vite dev server):

```bash
npm run build:web
npm run dev:server   # API + built SPA on http://acme.localhost:47100
```

Open **http://acme.localhost:47100** and **http://globex.localhost:47100** —
sign in as `demo@agentproofarch.dev` / `demo1234`. Each tenant domain shows its
own isolated todos (and its own accent color). Note: on `localhost` browsers
reject cross-subdomain cookies, so you sign in per tenant domain; on a real
base domain one session spans all tenant subdomains. `dev:server` serves
whatever `dist/web` holds (a gitignored build) — after a contract change an
old bundle fails every page, so rebuild or use `dev:web`.

## CLI — the agent feedback loop

```bash
npm run --silent cli -- login --email demo@agentproofarch.dev --password demo1234
npm run --silent cli -- tenant list
npm run --silent cli -- tenant switch acme
npm run --silent cli -- todo list
npm run --silent cli -- --tenant globex todo add Something for Globex
npm run --silent cli -- --json whoami        # single JSON document on stdout
```

Every command supports `--json` and exits with a code mapped from the error
taxonomy (`validation`=2, `unauthorized`=3, `forbidden`=4, `not_found`=5,
`conflict`=6, `tenant_not_found`=7, `internal`=10). That makes the CLI a
deterministic verification loop for AI agents — and the reference client.

## Architecture in one screen

```
core/domain     entities, Result, error taxonomy          → zod only
core/contract   API routes + schemas (single source)      → domain
core/server     use-cases + ports (interfaces)            → domain
core/client     typed HTTP client + query definitions     → contract
adapters/db     Drizzle repos, driver factory (pg|neon)   → implements ports
adapters/auth   Better Auth (server + client adapter)     → implements ports
apps/server     Hono wiring + composition root            → the only place adapters are instantiated
apps/web        React SPA (Vite, TanStack Router/Query)   → core/client only
apps/cli        commander commands                        → core/client only
```

Rules are **machine-enforced**: `eslint-plugin-boundaries` + `dependency-cruiser`
fail the build on any cross-layer import, on `@vercel/*`/`@neondatabase/*`
outside `adapters/`, and on any framework import inside `core/`. `any` and
type assertions (`as`, except `as const`) are lint errors.

## The two gates

```bash
npm run check   # static gate: typecheck + lint + lock-lint + depcruise + doc-lint + coverage
npm run smoke   # runtime gate: real server boots, CLI drives the full flow (~5s)
```

- **`check`** runs typecheck, ESLint (layer boundaries), `lock-lint`
  (validates `package-lock.json` under npm-10 semantics — the exact rules
  `npm ci` enforces on CI; a local npm 11 `npm install` silently prunes
  optional entries and broke CI twice, so **never `npm install` here** — add
  deps with `npx -y npm@10 install`), dependency-cruiser, `doc-lint`
  (docs ↔ enforcer-config, both ways), and vitest with coverage. **239 tests
  across 38 files**; coverage thresholds are a ratchet floor, so a regression
  fails the gate.
- **`smoke`** recreates an isolated `agentproofarch_smoke` database, boots the
  real server (`entry.node.ts`) and drives health → sign-in → todos →
  unauthorized through the CLI, asserting taxonomy exit codes. **Done =
  `check` green AND `smoke` green.** Static-green is not done.

Two more levels, their own CI jobs (browser + Postgres, kept out of `check`):

```bash
npm run test:integration   # 17 tests against a real Postgres (repositories)
npm run e2e                # 4 Playwright specs: real Chromium over the real stack
```

10 config-regression probes assert every boundary rule still fails on a
violating fixture — you can't silently delete a rule and stay green
([ADR-0004](../docs/decisions/0004-no-exceptions-enforcement.md)).

## Adding a resource

Start with the scaffolder — the canonical entry point:

```bash
npm run new:resource -- <singular-name>    # e.g. note, blog-post
```

It generates the files a resource owns (domain type, use-cases + test,
repository, web page + route) and prints an ordered checklist for the shared
files you wire by hand, each with its anchor line and a paste-ready snippet. It
does **not** edit shared files: the generated code imports symbols that don't
exist yet, so `npm run check` stays RED until every step is wired — the type
system enforces completion. Full narrated walkthrough:
[../docs/first-feature.md](../docs/first-feature.md).

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = org slug),
(3) `X-Tenant` header (CLI). Membership is verified in every case; every
tenant-scoped use-case takes `ctx.identity` and every repository call requires
`tenantId`.

## Deployment targets

Same commit, env only — live on Vercel today
([ADR-0003](../docs/decisions/0003-vercel-environments.md)):

| | Vercel | Docker self-host |
|---|---|---|
| API | Hono handler as a function (`api/index.ts` via `@hono/node-server/vercel`) | Node container (`entry.node.ts`) |
| DB | Neon, `DB_DRIVER=neon-http` | `postgres:16`, `DB_DRIVER=node-postgres` |
| Web | static build | served by the same Node process |

Production = `main` → <https://agentproofarch.vercel.app>; staging is a
long-lived branch; every PR gets a preview on an ephemeral Neon branch; each
deploy is re-verified by `smoke:remote` in `post-deploy-smoke`. Web is
single-tenant on `*.vercel.app` until a wildcard domain is attached (env, not
code); API/CLI stay multi-tenant via `X-Tenant`. The full Docker/Caddy story
is US-020…US-023 in the PRD and intentionally not built yet.
</content>
