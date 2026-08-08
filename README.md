# agentproofarch

Agent-first, strictly layered full-stack TypeScript foundation for multi-tenant SaaS.
The architecture is defined in [../docs/architecture.md](../docs/architecture.md)
(and distilled from [../docs/prd-agentproofarch-foundation.md](../docs/prd-agentproofarch-foundation.md));
this repo is the **walking skeleton**: auth, foundation-owned tenants (flat
`owner`/`admin` grants — no organizations/teams concept), tenant resolution by
domain, one tasks subdomain — todos plus the two exemplar boards (personal +
team) — flowing through every layer, a full CLI and a web SPA. Live at
<https://agentproofarch.vercel.app> (`demo@agentproofarch.dev` / `demo1234`).

New here? Read [../docs/first-feature.md](../docs/first-feature.md) — it adds a
real resource end-to-end in 30 minutes.

## Quickstart (local demo)

```bash
corepack enable && corepack prepare --activate
pnpm install --frozen-lockfile
pnpm run db:up        # Postgres 16 in Docker on port 47542
pnpm run db:migrate
pnpm run db:seed      # demo user + two tenants + todos
pnpm run dev:web      # frontend: Vite + hot reload on 47180 — the canonical dev path
```

`dev:web` is where **all frontend work** happens. For a prod-like page (the
server serving a built bundle instead of the Vite dev server):

```bash
pnpm run build:web
pnpm run dev:server   # API + built SPA on http://acme.localhost:47100
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
pnpm --silent run cli register --name Demo --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli login --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli tenant list
pnpm --silent run cli tenant switch acme
pnpm --silent run cli todo list
pnpm --silent run cli --tenant globex todo add Something for Globex
pnpm --silent run cli card list --board team           # team board cards
pnpm --silent run cli card add Ship it --board team --column todo
pnpm --silent run cli card move <id> --board team --to in-dev
pnpm --silent run cli --json whoami        # single JSON document on stdout
pnpm --silent run cli logout                           # drops the stored token
```

Full command set: `health`, `register`, `login`, `logout`, `whoami`,
`tenant list|create|switch`, `todo list|add`, `card list|add|move`.

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
apps/server     Hono wiring + composition root            → the only place server adapters are instantiated
apps/web        React SPA (Vite, TanStack Router/Query)   → core/client only
apps/cli        commander commands                        → core/client only
```

`composition.ts` is the only place a *server* adapter is instantiated. Two
deliberate exceptions: the auth *client* adapter is constructed in
`apps/web/src/api.ts` (web) and the CLI's `cliCtx`, and `adapters/db/migrate.ts`
reads `DB_DRIVER`/`DATABASE_URL`/`VERCEL` itself as a sanctioned composition
point outside the server root.

Rules are **machine-enforced**: `eslint-plugin-boundaries` + `dependency-cruiser`
fail the build on any cross-layer import, on `@vercel/*`/`@neondatabase/*`
outside `adapters/`, and on any framework import inside `core/`. `any` and
type assertions (`as`, except `as const`) are lint errors.

## The two gates

```bash
pnpm run check   # static gate: typecheck + lint + lock-lint + depcruise + knip + doc-lint + coverage
pnpm run smoke   # runtime gate: real server boots, CLI drives the full flow (~5s)
```

- **`check`** runs typecheck, ESLint (layer boundaries), `lock-lint`
  (proves `pnpm-lock.yaml` matches `package.json` under the frozen-lockfile
  semantics CI uses; add dependencies with `pnpm add`), dependency-cruiser, `knip`
  (dead files + dependency hygiene), `doc-lint`
  (docs ↔ enforcer-config, injected counts, env-schema ↔ `.env.example`, dead
  links), and vitest with coverage across
  **<!--count:test-files-->85<!--/count--> test files**; coverage thresholds are
  a ratchet floor, so a regression fails the gate.
- **`smoke`** recreates an isolated `agentproofarch_smoke` database, boots the
  real server (`entry.node.ts`) and drives health → sign-in → todos →
  unauthorized through the CLI, asserting taxonomy exit codes. **Done =
  `check` green AND `smoke` green.** Static-green is not done.

Dependency lifecycle scripts are blocked unless explicitly named in
`pnpm-workspace.yaml`'s minimal `onlyBuiltDependencies` allowlist. The same
configuration applies a three-day (`4320` minute) minimum-release-age cooldown.

Two more levels, their own CI jobs (browser + Postgres, kept out of `check`) —
<!--count:integration-tests-->48<!--/count--> integration tests against a real
Postgres and <!--count:e2e-tests-->15<!--/count--> Playwright tests across
<!--count:e2e-specs-->6<!--/count--> spec files:

```bash
pnpm run test:integration   # repositories, against a real Postgres
pnpm run e2e                # real Chromium over the real stack
```

<!--count:config-regression-->47<!--/count--> config-regression probes guard the
covered boundary and island-core rules — most feed a violating fixture and
assert the gate still goes red, a few are structural rule-presence checks rather
than fixture-feeding probes — so you can't silently delete one of those rules and
stay green ([ADR-0004](../docs/decisions/0004-no-exceptions-enforcement.md)).

## Adding a resource

Start with the scaffolder — the canonical entry point:

```bash
pnpm run new:resource -- <singular-name>    # e.g. note, blog-post
```

It generates the files a resource owns (domain type, use-cases + test,
repository, web page + route) and prints an ordered checklist for the shared
files you wire by hand, each with its anchor line and a paste-ready snippet. It
does **not** edit shared files: the generated code imports symbols that don't
exist yet, so `pnpm run check` stays RED through the type-forced steps (domain,
contract, port/use-case, client wiring). Three steps — the CLI command,
server-route registration, and the web route — typecheck fine while unwired, so
for those the checklist, not the compiler, enforces completion. Full narrated
walkthrough:
[../docs/first-feature.md](../docs/first-feature.md).

Its client-state sibling scaffolds a feature (island) with a rung-1 island
core — the events-in / selectors-out seam of
[ADR-0005](../docs/decisions/0005-client-application-state.md):

```bash
pnpm run new:island -- <name>               # e.g. personal-board
```

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = tenant slug),
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
| Tenant domains | `DOMAIN_PROVISIONER=vercel` + `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` (+ `VERCEL_TEAM_ID`) — each host attached to the project, HTTP-01 cert per host | `DOMAIN_PROVISIONER=caddy` + `SELF_HOST_TARGET_CNAME`/`_IP` — Caddy on-demand TLS |

Production = `main` → <https://agentproofarch.vercel.app>; staging is a
long-lived branch; every PR gets a preview on an ephemeral Neon branch; each
deploy is re-verified by `smoke:remote` in `post-deploy-smoke`. Web is
single-tenant on `*.vercel.app` until a wildcard domain is attached (env, not
code); API/CLI stay multi-tenant via `X-Tenant`.

The Docker self-host target is **built** (US-021 + US-022, DECIDE A2): a
multi-stage `Dockerfile` (SPA + tsc-compiled server, prod-only deps, non-root,
`HEALTHCHECK`), `docker-compose.prod.yml` (`postgres:16` + app + an
`edge`-profiled Caddy for on-demand TLS) and `docker-entrypoint.sh` (runs
migrations on startup). A dedicated CI job (`selfhost.yml`) builds the image,
boots the stack and runs the smoke CLI against the container on every push.
Self-host issues TLS via Caddy and needs no platform API; the **Vercel** Domains
API adapter (US-020, `DOMAIN_PROVISIONER=vercel`) is the other target's
equivalent — it attaches each tenant host to the Vercel project, and is tested
against a stubbed `fetch` only until the owner supplies `VERCEL_TOKEN`.

### Self-host with Docker

```bash
cp .env.example .env     # set BETTER_AUTH_SECRET; for real TLS also set APP_BASE_URL
                         # (https), APP_BASE_DOMAIN and SECURE_COOKIES=true
docker compose -f docker-compose.prod.yml up -d --build
#  -> postgres + app; the entrypoint migrates on startup, then serves API + SPA
#     on http://localhost:47100. Add SEED_ON_START=true to .env for demo data.
```

Add the Caddy edge (on-demand TLS terminator, binds 80/443, needs `Caddyfile`)
for a real domain:

```bash
docker compose -f docker-compose.prod.yml --profile edge up -d --build
```

Backup and disaster recovery for this target — the hourly k3s `pg_dump` CronJob
against Neon, the encrypted offsite copy, and the cold-standby restore runbook —
live in [`ops/backup/`](ops/backup/README.md). They are installed by hand on the
owner's VPS and are not part of any CI job.

## Operating hygiene for agent-driven repos

When agents (and humans) share this repo, safety is an operating property of the
environment, not a policy list in an agent file — a rule an agent is asked to
"remember" is not an enforcement (DECIDE B5). These are recommendations for the
humans who own the platform; the architecture (`../docs/architecture.md`
§Environments) is where the enforced version lives.

- **Production secrets live only in the platform env store, set by humans.** Real
  `BETTER_AUTH_SECRET`, database URLs and provider keys are entered in Vercel's
  environment UI, scoped per environment, by a person — never committed, never
  pasted into an agent session. `.env.example` documents *names* only. An agent
  works against local dev or a preview, whose secrets are disposable.
- **Agents never hold production access.** No platform CLI (`vercel`, `neonctl`,
  cloud provider CLIs) stays logged in on a machine an agent drives, and no
  production database URL is reachable from an agent's shell. "Deweloper ani agent
  nigdy nie działa bezpośrednio na produkcji" — production is reached only through
  the promotion gate below, never a direct connection.
- **Block the dangerous edges at the tool boundary.** Configure the agent
  harness's hook/sandbox layer to deny what an agent should never do — writes
  outside the worktree, network to production hosts, `rsync`/`rm -rf` on shared
  mounts, and launching platform CLIs. A blocked command is enforcement; a
  documented "please don't" is not.
- **Production release is an owner-approved PR gate.** Vercel Production Branch
  Tracking points at the `production` branch, guarded by the
  `production-protection` GitHub ruleset (require a PR + 1 approval, empty bypass).
  An agent (a Write-not-Admin machine account) merges freely to `main` — which
  builds a **preview/staging** deployment — but the production build is triggered
  only by a `main → production` PR the **owner** approves and merges from a device
  the agent does not control. The same commit flows feature branch → preview →
  `main` (staging) → `production`; only env vars differ, and only the owner
  crosses the last edge, reviewing the diff **before** the merge that triggers the
  secret-exposed build.
- **The AI-review gate fails closed.** A review check that cannot run — limits
  hit, tool unavailable, timeout — is a **red** check, never a skipped/green one.
  "Could not verify" and "verified safe" must never collapse to the same colour;
  an inability to run blocks the merge exactly like a found defect.
- **Post-deploy SHA attestation is the trust anchor.** Every deploy exposes its
  build commit SHA on `/api/health*`, and `smoke:remote` asserts the live SHA
  equals the SHA that was reviewed and promoted. That attestation — not a claim in
  a log — is what proves the running code is the code that passed the gates.

### The `ai-review` gate (implementation of "fails closed")

The [`ai-review`](../.github/workflows/ai-review.yml) workflow is the running
version of the fail-closed bullet above (DECIDE F1). It runs
[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action)
(pinned to a commit SHA) on `pull_request` `opened`/`synchronize`/`ready_for_review`
targeting `main`, skipping drafts (a draft cannot be merged, and marking it ready
re-triggers the gate). PRs from forks are not skipped: fork runs receive no
secrets, so every slot skips and the gate exits RED — fail-closed, because a
skipped required check would count as passing. Sonnet reviews **only the PR diff**
(`git diff origin/main...HEAD`, not the whole repo — cost) against this repo's
doctrine (`CLAUDE.md`, the per-layer `CLAUDE.md`s, `architecture.md` §Layers/
§Principles/§Authorization) and returns a machine-readable verdict via the
action's `--json-schema` structured output: `{ verdict: PASS | FAIL, summary,
blocking_issues, safe_to_merge, blast_radius: { scope: isolated | contained |
broad, note } }`.

- **Verdict → exit code.** The action's `structured_output` is the only source of
  truth. `.github/scripts/classify-review.sh` maps each attempt to
  `pass | fail | infra`; `gate-review.sh` exits `0` **only** on a `PASS` and `1`
  on everything else. The model gets read-only tools and never sets the exit code
  directly — the workflow does.
- **Fail-closed.** There is exactly one green path: a positive `PASS`. A `FAIL`
  verdict, an infra failure (rate-limit / auth / network / the known
  `--json-schema` CLI hang, bounded by `timeout-minutes`) on every available
  token slot, an empty or malformed model output, or a missing `…_TOKEN_1` secret
  all exit RED. "Could not verify" never renders green. Because the gate defaults
  to RED unless it positively reads a `PASS`, a rare false-RED (e.g. the
  documented cold-start flake, [claude-code#23265](https://github.com/anthropics/claude-code/issues/23265))
  is a blocked merge the owner re-runs — never a silent pass.
- **Token failover, infra-only.** Slots are tried in order:
  `CLAUDE_CODE_OAUTH_TOKEN_1` (present today), then the wired-but-optional `…_2`
  and `…_3`. A later slot is attempted **only** when the earlier slot produced no
  verdict (infra failure); a legitimate `PASS`/`FAIL` fails fast and never burns
  the next token re-running the same verdict. Absent slot secrets are skipped
  cleanly (a preflight step emits presence booleans without ever echoing a token).
  GitHub Actions has no native cross-step token failover — this ordered-attempt
  ladder is the smallest honest wrapper for it.
- **Posting.** The verdict is posted back as a single sticky PR comment
  (`post-review.sh`, edit-last-else-create) — best-effort, so a comment-API hiccup
  cannot flip a real `PASS` to RED. The comment opens with the verdict
  (`🤖 AI review: PASS ✅` / `FAIL ❌`), then the safe-to-merge call and the blast
  radius, a `Summary` section, a `Blocking issues` list when non-empty, and a
  footer read from the attempt's execution log: resolved model id, turns, token
  totals and the API-equivalent cost. Safe-to-merge renders `no` on anything but
  a `PASS` — the fail-closed doctrine decides what may merge, not the model's
  self-assessment.
- **Secrets hygiene.** The OAuth token is a subscription-scoped, rotatable,
  limited-value credential from `claude setup-token` — **not** a production
  secret, so keeping it as a repo Actions secret does not violate the
  "production secrets never in Actions" rule above. The workflow never echoes it.

**Required on `main-gates` (since 2026-07-26).** The gate shipped non-required
to accumulate a verdict track record; the owner has since added the
status-check context **`ai-review`** (the job name) to the `main-gates`
ruleset's required-checks list, so a PR without a PASS verdict cannot merge to
`main`. Disarming it is the same Admin-only ruleset edit in reverse.

**Adding slot `_2` / `_3` later.** Create repo Actions secrets
`CLAUDE_CODE_OAUTH_TOKEN_2` / `_3` (each its own `claude setup-token`). No workflow
edit is needed — the slots are already wired and skip cleanly while absent.
