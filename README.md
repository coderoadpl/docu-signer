# Podpisy

Agent-first, strictly layered full-stack TypeScript document archive.
The architecture is defined in [docs/architecture.md](docs/architecture.md)
(and distilled from [docs/prd-agentproofarch-foundation.md](docs/prd-agentproofarch-foundation.md));
this repo is the **walking skeleton**: authentication, account security,
tenant-scoped document storage, health surfaces, a CLI and a web SPA. Tenant
resolution remains infrastructure; tenant, staff, member and domain-management
surfaces from the upstream demo are intentionally absent. The upstream reference is live at
<https://agentproofarch.vercel.app> (`demo@agentproofarch.dev` / `demo1234`).

## Quickstart (local demo)

This operator quickstart is a convention, not a mechanically enforced gate.

```bash
corepack enable && corepack prepare --activate
pnpm install --frozen-lockfile
pnpm run db:up        # Postgres 16 in Docker on port 47542
pnpm run db:migrate
pnpm run db:seed      # two trusted archive users + the default tenant
pnpm run dev:web      # frontend: Vite + hot reload on 47180 — the canonical dev path
```

`dev:web` is where **all frontend work** happens. For a prod-like page (the
server serving a built bundle instead of the Vite dev server):

```bash
pnpm run build:web
pnpm run dev:server   # API + built SPA on http://default.localhost:47100
```

Open **http://default.localhost:47100** and sign in as
`demo@agentproofarch.dev` / `demo1234`. `dev:server` serves
whatever `dist/web` holds (a gitignored build) — after a contract change an
old bundle fails every page, so rebuild or use `dev:web`.

## Signing archived PDFs

Every source PDF on a document detail page has a **Podpisz** action. The
full-screen Polish signing view renders one page at a time, captures pen,
touch or mouse strokes, and lets the user undo, clear, move and resize the
signature. Saving flattens the ink into the selected PDF page in the browser
and uploads `<source>-podpisany.pdf` as a new `signed-digital` file; the source
is never replaced. Signature ink is not stored separately or reused. The same
signing view can open **Pad QR**; a logged-in phone or tablet at `/pad/{sessionId}`
becomes a blank signing pad for that desktop session, with the secret kept in
the URL fragment and sent to the API only as a header.

## CLI — the agent feedback loop

With `pnpm run dev:server` running:

```bash
pnpm --silent run cli login --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli document list
pnpm --silent run cli document add "Signed agreement" --date 2026-08-01 --type umowa-uod
pnpm --silent run cli document upload <id> agreement.pdf --role source
pnpm --silent run cli document verify-seal <id>
pnpm --silent run cli document export <id> --output agreement.zip
pnpm --silent run cli tenant-settings set --pdf-seal-enabled true --date-mode declared
pnpm --silent run cli --json whoami                    # single JSON document on stdout
pnpm --silent run cli logout                           # drops the stored token
```

Inside this repository the CLI defaults to
`http://default.localhost:47100`, matching the tenant host created by the dev
seed. Use `--api-url` or `APP_CLI_API_URL` to target another origin.

Full command set (<!--count:cli-command-groups-->13<!--/count--> top-level groups):
`health`, `register`, `login`, `login-link`, `logout`, `whoami`,
`origin list|use`, `account change-password|request-password-reset`,
`tenant-settings show|set`,
`document list|trash-list|search|show|add|approve|unapprove|waive-signature|require-signature|upload|verify-seal|export|remove|restore|purge`,
`token create|list|revoke`, `public profile`.

Every command also accepts `--token <value>` (or the `APP_CLI_TOKEN` env var)
to authenticate with a personal API token instead of the stored session;
the flag wins over the env var, which wins over the profile session.

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
`apps/web/src/api.ts` (web) and the CLI's `cliCtx`; the standalone
`adapters/db/migrate.ts`, `adapters/db/seed.ts`, and
`adapters/db/seed-deploy.ts` operations are sanctioned composition points
outside the server root.

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
  (docs ↔ enforcer-config, injected counts, env-schema ↔ `.env.example`,
  server ↔ Vercel CSP sync, dead links), and vitest with coverage across
  **<!--count:test-files-->108<!--/count--> test files**; coverage thresholds are
  a ratchet floor, so a regression fails the gate.
- **`smoke`** recreates an isolated `agentproofarch_smoke` database, boots the
  real server (`entry.node.ts`) and drives health → sign-in → document archive →
  cleanup → unauthorized through the CLI, asserting taxonomy exit codes. **Done =
  `check` green AND `smoke` green.** Static-green is not done.

Dependency lifecycle scripts are blocked unless explicitly named in
`pnpm-workspace.yaml`'s minimal `onlyBuiltDependencies` allowlist. The same
configuration applies a three-day (`4320` minute) minimum-release-age cooldown.

Two more levels, their own CI jobs (browser + Postgres, kept out of `check`) —
<!--count:integration-tests-->26<!--/count--> integration tests against a real
Postgres and <!--count:e2e-tests-->32<!--/count--> Playwright test executions
across <!--count:e2e-specs-->6<!--/count--> spec files: Chromium covers all
six, and WebKit reruns `documents.spec.ts` to pin the Safari/pdf.js legacy
regression.

```bash
pnpm run test:integration   # repositories, against a real Postgres
pnpm run e2e                # Chromium all specs + WebKit documents over the real stack
```

<!--count:config-regression-->43<!--/count--> config-regression probes guard the
covered boundary rules — most feed a violating fixture and
assert the gate still goes red, a few are structural rule-presence checks rather
than fixture-feeding probes — so you can't silently delete one of those rules and
stay green ([ADR-0004](docs/decisions/0004-no-exceptions-enforcement.md)).

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = tenant slug),
(3) `X-Tenant` header. Access is verified in every case; every
tenant-scoped use-case takes `ctx.identity` and every repository call requires
`tenantId`.

## Deployment

The Vercel serverless target remains available through `vercel.json` and
`api/index.ts`, with Neon selected by `DB_DRIVER=neon-http`. The deploy seed
binds `APP_BASE_DOMAIN` to the fixed `default` tenant. This fork does not ship
tenant-domain management or a self-host deployment package.

## Backups

The nightly backup cron runs from the private `docu-signer--backup` repository,
which checks out this repo and runs `scripts/backup.ts` to create a full
PostgreSQL + private Blob ZIP in a dedicated Google Workspace Shared Drive.
Setup, retention, guards, and the exact restore procedure are in the
[backup runbook](docs/backup.md).

## Operating hygiene for agent-driven repos

When agents (and humans) share this repo, safety is an operating property of the
environment, not a policy list in an agent file — a rule an agent is asked to
"remember" is not an enforcement (DECIDE B5). These are recommendations for the
humans who own the platform; the architecture (`docs/architecture.md`
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
- **Production release is an owner-approved PR gate.** In this fork Vercel
  tracks `main` and there is no `production` branch, so the wall sits on
  `main` itself: since 2026-08-15 the `require-gates` ruleset requires a PR
  with one approving **owner** review plus green
  `check`/`smoke`/`e2e`/`ai-review` before anything lands, with no bypass
  actors (see FOUNDATION.md) — the agent (a machine account) prepares PRs;
  the owner promotes by approving — the merge itself may then be executed by
  either party. The same commit flows feature
  branch → preview → `main` (production); only env vars differ, and the owner
  reviews the diff **before** the merge that triggers the secret-exposed
  production build.
- **The AI-review gate fails closed.** A review check that cannot run — limits
  hit, tool unavailable, timeout — is a **red** check, never a skipped/green one.
  "Could not verify" and "verified safe" must never collapse to the same colour;
  an inability to run blocks the merge exactly like a found defect.
- **Post-deploy SHA attestation is the trust anchor.** Every deploy exposes its
  build commit SHA on `/api/health*`, and `smoke:remote` asserts the live SHA
  equals the SHA that was reviewed and promoted. That attestation — not a claim in
  a log — is what proves the running code is the code that passed the gates.

### The `ai-review` gate (implementation of "fails closed")

The [`ai-review`](.github/workflows/ai-review.yml) workflow is the running
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
  directly — the workflow does. These control scripts are loaded from the pull
  request's base SHA in a separate checkout; the head checkout supplies only the
  diff under review and cannot replace the classifier, poster or gate.
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

**Required by ruleset since 2026-08-15.** `ai-review` is one of the four
required checks on this fork's `require-gates` ruleset (FOUNDATION.md), so a
FAIL verdict blocks the merge server-side — and the agent additionally treats
a red `ai-review` as unmergeable by discipline.

**Adding slot `_2` / `_3` later.** Create repo Actions secrets
`CLAUDE_CODE_OAUTH_TOKEN_2` / `_3` (each its own `claude setup-token`). No workflow
edit is needed — the slots are already wired and skip cleanly while absent.

## License

[FSL-1.1-ALv2](LICENSE.md) — the Functional Source License. You may self-host
and modify it freely; competing commercial use is not permitted (see the
license for what counts as a Competing Use).
Every release automatically converts to Apache-2.0 two years after publication.
More: [fsl.software](https://fsl.software/) and [fair.io](https://fair.io/).
