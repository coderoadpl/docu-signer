# agentproofarch — rules for agents

Architecture spec: `docs/prd-agentproofarch-foundation.md` (see also `docs/architecture.md`) (§3 is normative).

**Scale ruling (owner, 2026-07-27):** this is a non-commercial tool for 2
users. Structural rules apply in full; ceremony does not graduate without a
named trigger. Conscious deviations from the upstream foundation are recorded
one line each in [FOUNDATION.md](FOUNDATION.md) — read it before invoking
upstream doctrine, and prefer simplicity + a delta line over new ADRs.

## The two gates

- `pnpm run check` = typecheck + ESLint (boundaries) + lock-lint (proves
  `pnpm-lock.yaml` matches `package.json` with the same frozen-lockfile
  semantics as the Node 24 CI runner) + dependency-cruiser +
  knip (dead files + dependency hygiene; unused exports/types stay advisory
  during the PRD build-out — see `knip.jsonc`) +
  doc-lint (docs↔config enforcer coverage, injected count tokens, env-schema ⊆
  `.env.example`, server↔Vercel CSP sync, dead relative links) + vitest with
  `--coverage` — the
  **static** gate; coverage thresholds are a ratchet floor (measured minimum
  rounded down, per-metric) enforced here, so a coverage regression fails
  `pnpm run check`.
- `pnpm run smoke` = the **runtime** gate: it verifies the installed dependency
  tree matches `pnpm-lock.yaml`, drops+recreates an isolated
  `agentproofarch_smoke` database (never touches your dev-seeded data), migrates
  and seeds it, boots the real server (`entry.node.ts`) on an ephemeral port and
  drives health → sign-in → documents through the CLI, asserting taxonomy exit codes
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

Security-relevant rule reversals require an owner-visible artifact in the repo
before ai-review may accept them; the rulings are archived verbatim in
[docs/owner-rulings.md](docs/owner-rulings.md).

- `pnpm run e2e` = the **browser** gate: Playwright drives real browsers over
  the real stack (isolated `agentproofarch_e2e` DB, `localhost` registered as a
  single-tenant custom domain, `entry.node.ts` serving the built bundle): Chromium
  covers all six spec files (21 tests), and WebKit reruns `documents.spec.ts` to
  pin the Safari/pdf.js legacy regression (32 test executions total):
  `app.spec.ts` (login → archive navigation →
  failed-login → cache headers → liveness/readiness → anonymous redirect to login),
  `documents.spec.ts` (create → role uploads → source-only preview link +
  content-type → export; detail signing; immediate source replacement with
  signature transfer; trash → restore roundtrip; signature pad pen/touch stamp
  placement; QR remote pad two-context mass signing; draft-filter approve
  roundtrip; mass review sizing/default modes; mass signing sign/skip and
  signed-file-target flows),
  `magic-link.spec.ts` (trusted-user sign-in), `passkey.spec.ts`
  (registration → passkey sign-in), `settings.spec.ts` (account security and
  registration), and `password-reset.spec.ts`
  (password change + email reset link via Mailpit). The harness boots the
  server with `AUTH_RATE_LIMIT: 'off'` (`scripts/e2e-server.ts`) — the baseline
  is on (including dev), but the specs replay many logins that would otherwise
  trip the limiter and flake the run. It needs a browser and Postgres, so it is
  its own CI job (`e2e`), never part of `check`.

- `pnpm run visual` = the **pixel** check
  ([ADR-0008](docs/decisions/0008-visual-regression.md)): Playwright
  `toHaveScreenshot()` over the same boot harness, in its own suite
  (`visual/`, `playwright.visual.config.ts`) so a moved screenshot can never
  redden `e2e`. It is **not a required check** — the required set is
  `check`/`smoke`/`e2e`/`ai-review` (enforced by the `require-gates` ruleset
  since 2026-08-15 — see FOUNDATION.md), and
  `visual` stays out of it until the owner arms it. The `visual` workflow runs
  only when dispatched, nightly at 03:17 UTC, and on pushes to `main`; pull
  requests do not trigger it. Baselines
  (`visual/__screenshots__/<platform>/`) are rendered by the linux CI runner via
  the `visual-baselines` workflow and committed; a mac run compares nothing
  (`ignoreSnapshots`), so it can neither author nor overwrite them. Changing the
  UI on purpose means dispatching `visual-baselines` with `update: true` and
  committing the new PNGs in the same PR.

## Product surface

- Dokumenty: archive metadata and PDF/image files by role, preview and export
  them, and hand-sign any source PDF in a full-screen pen/touch/mouse flow.
  A full-screen mass-review queue shows each selected source or newest digital
  signature and supports lightweight metadata editing without signing controls.
  The mass-review reader falls back signed-digital → scan → source, so
  paper-only documents open on their scan. Documents that never get signed
  (e.g. rachunki) can be marked "Nie wymaga podpisu" — singly, in bulk, or via
  the CLI `document waive-signature|require-signature` pair — which removes
  them from the needs-signature filter and mass-signing queues and shows a
  quiet gray chip instead of a pending state.
  Signing flattens ink client-side into a new `signed-digital` PDF; it never
  replaces the source. With the tenant's signature-box setting on, that
  flatten also bakes a visible first-page annotation (top-right: the signers
  in order with their declared signing times); re-signing a signed file
  redraws the cumulative annotation over the previous one at the same anchor.
  When the tenant's PDF-seal setting is on, the server
  then adds an invisible, externally verifiable PAdES organization seal; Tryb
  dat chooses its signer-claimed time from the entered signing date or the true
  wall clock. With the signature-record setting on, each signing session also
  stores its signature ink (stroke geometry, placement, color, size) bound by
  foreign key to that document — a deliberate reversal of the 2026-08-01
  never-store-ink rule (owner decision 2026-08-07, provenance in
  FOUNDATION.md) so the same document's signatures can be re-flattened onto a
  corrected source. No product surface offers applying stored ink to any
  other document. Each stored stamp records the account that contributed its
  ink, including ink submitted from an authenticated remote pad. A desktop
  signing user has one global remote pad host session shared by every signing
  surface at `/pad/{sessionId}`. Private sessions require the same account;
  shared sessions admit any account in the tenant by QR fragment secret or
  identity join, track participants separately from host-session slots, and
  queue proactive server-attributed signatures for deliberate placement in the
  current document. The pad defaults to a touch-locked Piórko mode with an
  explicit Ręka mode for finger drawing.
- Dokumenty show only user-entered dates (`data podpisania`, `okres`); storage
  timestamps (`createdAt`, `updatedAt`) never render in UI or exports. Two
  carve-outs: `deletedAt` records a user action and renders as `Usunięto:` in
  the Kosz surfaces only (owner decision 2026-08-02); API token `lastUsedAt` is
  a system-written security-audit timestamp and renders as `Ostatnio użyty:` in
  Konto > Tokeny API only — token hygiene is that surface's purpose, and it is
  an account-security surface, not a document surface (agent decision
  2026-08-02, recorded in FOUNDATION.md).
- Konto: display-name editing (Profil — the name the app bar and signer
  attribution render), personal passkeys, API tokens, two-factor
  authentication and the tenant-wide signature-ink storage, PDF-seal,
  signature-box annotation and Tryb dat controls (Ustawienia organizacji).
  Removed upstream verticals stay removed.

## Layer rules (enforced, but know them anyway)

Per-layer one-screen summaries live beside the code — [`core/CLAUDE.md`](core/CLAUDE.md), [`adapters/CLAUDE.md`](adapters/CLAUDE.md), [`apps/CLAUDE.md`](apps/CLAUDE.md) (each with `AGENTS.md` symlink) — read the one for the layer you are editing.

- `core/**` is pure TypeScript: no hono, react, drizzle, better-auth, pg, commander.
- `core/domain` depends on zod only. `core/server` = use-cases + ports.
  `core/contract` = the only bridge between server and clients.
  `core/client` = the only way any client talks HTTP.
- `adapters/**` implement ports; only `apps/server/src/composition.ts`
  instantiates a *server* adapter. Two deliberate exceptions: the auth *client*
  adapter is constructed in `apps/web/src/api.ts` (web) and the CLI's `cliCtx`,
  the CLI's read-only `document verify-seal` command constructs the PDF seal
  verification adapter, and the standalone DB/ops entrypoints `adapters/db/migrate.ts`,
  `adapters/db/seed.ts`, `adapters/db/seed-deploy.ts`, and
  `scripts/backup.ts` are sanctioned composition points outside the server
  root. Backup runs from the private `docu-signer--backup` repo's cron without
  the server. Seed needs the real auth and
  database adapters to hash credentials and persist bootstrap data, just as
  migrate needs the real database adapter.
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
  default-deny; see `docs/architecture.md` §Authorization) — before any
  repository access. There are no allowlisted exceptions today; any future
  authentication-only exception must be named and reasoned explicitly.

## Verify features through the CLI first

```bash
pnpm run db:up && pnpm run db:migrate && pnpm run db:seed
pnpm run dev:server &          # port 47100
pnpm --silent run cli --json health
pnpm --silent run cli login --email demo@agentproofarch.dev --password demo1234
pnpm --silent run cli document list
```

`--json` prints exactly one JSON envelope on stdout; exit codes come from
`EXIT_CODE_BY_ERROR_CODE`. Adding a resource walks a 12-step chain: domain →
contract → port → use-case index → adapter schema → composition → server routes
→ client → client queries → CLI → web binding → web route, in that order, with
tests at the core layer.

## Dev notes

- **Frontend work goes through `pnpm run dev:web`** (Vite on 47180, hot reload) —
  that is the canonical dev path. `pnpm run dev:server` serves whatever `dist/web`
  holds, which is a gitignored build: after a contract change an old bundle fails
  every page with "response does not match the contract" (incident 2026-07-12).
  The server warns at boot when `dist/web` is missing or older than the
  web/contract sources; on that warning run `pnpm run build:web` or switch to
  `dev:web`.
- Ports: API 47100, Vite dev 47180, Postgres 47542 (never 3000/8080/5432).
- Container engine on the dev Mac is **Colima** (owner decision 2026-08-04;
  Docker Desktop retired for RAM reasons, left installed but never started).
  Same `docker` CLI via the `colima` context; if `docker ps` cannot reach the
  daemon, run `colima start --memory 2 --cpu 2` — never launch Docker Desktop.
- The fixed tenant lives at `default.localhost:47100`. Browsers reject
  `Domain=.localhost` cookies → per-subdomain login in dev only.
- Better Auth CSRF requires an `Origin` header on auth POSTs (CLI sends its API URL).
- Seed is idempotent; demo credentials `demo@agentproofarch.dev` / `demo1234`.
