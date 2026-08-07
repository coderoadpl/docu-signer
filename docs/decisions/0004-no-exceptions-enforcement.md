# ADR-0004: No-exceptions enforcement — CI gates, post-deploy verification, and config-regression probes

Date: 2026-07-17 · Status: accepted (2026-07-17), with one sub-decision deferred to the owner (see Consequences)

## Context

The foundation's two gates (`npm run check` static, `npm run smoke` runtime)
are only worth anything if they actually run on every change and cannot be
silently bypassed. Two classes of failure proved that running them locally,
by hand, on the honour system, is not enough:

1. **Five consecutive deploy-config failure layers** (PRs #10–#15): native
   subpath imports, the Vercel handler runtime, handler arity, the body
   parser, region co-location, and `NODEJS_HELPERS`. Every one of these was
   **static-green** — typecheck, lint, dependency-cruiser and vitest all
   passed — yet production was broken. Static analysis cannot see a runtime
   contract with the platform.
2. **Three stale-local-state incidents** where a green local run reflected an
   out-of-date `node_modules` or database rather than the committed tree, so
   "works on my machine" diverged from "works from a clean checkout".

The lesson is the project's own rule made load-bearing: **static-green is not
done.** The app must actually boot and be driven end-to-end, from a clean
checkout, on every PR and after every deploy — and the enforcers themselves
must be proven to still enforce, so nobody can quietly delete a rule and stay
green.

## Decision

1. **Both gates are required CI checks on every PR.** A GitHub Actions
   workflow (`ci`) runs on `pull_request` and on `push` to `main`:
   - **`check`** — `npm ci && npm run check` (typecheck + ESLint boundaries +
     dependency-cruiser + vitest), the static gate, from a clean install.
   - **`smoke`** — `npm ci && npm run smoke` against a `postgres:16` service
     container, the runtime gate: it verifies the installed tree matches
     `package-lock.json`, drops+recreates the isolated `agentproofarch_smoke`
     database, migrates, seeds, boots the real server and drives
     health → sign-in → todos → unauthorized through the CLI. A clean CI
     checkout structurally cannot carry stale local state, which closes the
     second failure class.

2. **Post-deploy verification against real production.** A second workflow
   (`post-deploy-smoke`) listens for the `deployment_status` event and, when a
   **Production** deployment reports **success**, checks out the deployed
   commit and runs `npm run smoke:remote` against the deployment's
   `environment_url` (via the `BASE_URL` the script reads). This is the only
   gate that exercises the actual platform contract that broke in #10–#15;
   it turns "deployed" into "deployed and verified working".

3. **Config-regression probes.** The lint and dependency-cruiser
   configurations are themselves covered by behavioural tests: a deliberately
   violating fixture MUST fail the gate. If someone weakens or deletes a rule,
   the corresponding probe goes green where it should be red and the test
   suite fails. The enforcers are enforced; you cannot disable a rule silently
   and keep CI green.

4. **Doc-lint.** Docs and enforcer configuration must stay in sync both ways
   (`npm run doc-lint`, `scripts/doc-lint.ts`, wired into the `check` chain).
   - **docs → config**: every enforcer the docs promise must still exist in
     configuration. An in-script manifest maps prose-promised guarantees (layer
     boundaries, the `@vercel/*`/`@neondatabase/*` containment, "no `any`", "no
     `as`", "features are islands") to their concrete ESLint / dependency-cruiser
     entries, each with the doc section it is promised in; any literal
     `agentproofarch/<rule>` id spelled in the docs is checked too. The docs
     cannot drift into describing guarantees the config no longer provides.
   - **config → docs**: every custom rule in `eslint-plugin-agentproofarch/rules`
     (excluding `*.test.js`) must be documented by name somewhere under `docs/`,
     so an enforcer cannot be added in silence.
   Failure output names the identifier, which side is missing it, and which file
   to fix.

## Consequences

- Every PR is marked red until both gates pass, and every production deploy is
  independently re-verified end-to-end. The two historical failure classes —
  runtime-only breakage and stale local state — are both structurally caught.
- **Branch protection cannot be server-enforced on this repo today (honest
  limitation).** The repository is **private under GitHub Free**, and the
  branch-protection / required-status-checks API returns
  `403 "Upgrade to GitHub Pro"`. So while CI *runs* and *marks PRs red*, GitHub
  will not *block* a merge on a failing or missing check. The options are:
  (a) make the repository **public** (branch protection becomes free),
  (b) buy **GitHub Pro**, or (c) **discipline-only** — treat a red check as a
  hard stop by convention until then. **This choice is deferred to the owner.**
  Regardless of which is chosen, CI still runs on every PR and every deploy and
  still turns the checks red; only the server-side *merge block* is contingent
  on that decision.
- CI must not run on the mirror. The repo is auto-mirrored to
  `coderoadpl/agentproofarch-mirror`; every job is guarded with
  `if: github.repository == 'chomamateusz/agentproofarch'` so the mirror never
  spends Actions minutes or fails on missing secrets/services.
- The `smoke` job needs a Postgres service container in CI, but no
  `docker compose`: `smoke.ts` creates and drops its own isolated
  `agentproofarch_smoke` database over the provided `DATABASE_URL`, so a bare
  `postgres:16` service on `localhost:5432` is sufficient.
- Config-regression and doc-lint probes add maintenance surface (fixtures must
  track the rules they guard), accepted as the price of making "you cannot
  silently disable a rule" a mechanical guarantee rather than a hope.
