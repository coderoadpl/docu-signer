# ADR-0004: No-exceptions enforcement — CI gates, post-deploy verification, and config-regression probes

> **Current mechanism, historical examples.** Podpisy retains the gates and
> doc/config checks; smoke now drives documents and removed island/scaffolder
> probes are no longer part of the count.

Date: 2026-07-17 · Status: accepted (2026-07-17), with one sub-decision deferred to the owner (see Consequences)

## Context

The foundation's two gates (`pnpm run check` static, `pnpm run smoke` runtime)
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
   - **`check`** — `pnpm install --frozen-lockfile && pnpm run check`, the static gate, from a clean
     install. Its seven members are: typecheck + ESLint (layer boundaries) +
     lock-lint + dependency-cruiser + knip + doc-lint + vitest with coverage.
   - **`smoke`** — `pnpm install --frozen-lockfile && pnpm run smoke` against a `postgres:16` service
     container, the runtime gate: it verifies the installed tree matches
     `pnpm-lock.yaml`, drops+recreates the isolated `agentproofarch_smoke`
     database, migrates, seeds, boots the real server and drives
     health → sign-in → documents → unauthorized through the CLI. A clean CI
     checkout structurally cannot carry stale local state, which closes the
     second failure class.

   The former fresh-clone `quickstart:probe` CI step is no longer a gate. It
   was removed with the demo verticals it drove; the README quickstart remains
   operator convention rather than an executable guarantee (see
   `FOUNDATION.md`).

2. **Post-deploy verification against real production.** A second workflow
   (`post-deploy-smoke`) listens for the `deployment_status` event and, when a
   **Production** deployment reports **success**, checks out trusted `main`,
   rejects the event SHA unless it is an ancestor of `origin/main`, and runs
   `pnpm run smoke:remote` from that trusted checkout against the production
   alias (via the `BASE_URL` the script reads). `EXPECTED_SHA` separately
   attests that the live deployment is the event SHA. Previews sit behind
   Vercel Authentication and are not remotely smoked (see FOUNDATION.md).
   This is the only gate that exercises the actual platform contract that broke
   in #10–#15; it turns "deployed" into "deployed and verified working".

3. **Config-regression probes.** The lint and dependency-cruiser
   configurations are themselves covered by behavioural tests: a deliberately
   violating fixture MUST fail the gate. If someone weakens or deletes a rule,
   the corresponding probe goes green where it should be red and the test
   suite fails. The enforcers are enforced; you cannot disable a rule silently
   and keep CI green.

4. **Doc-lint.** Docs and enforcer configuration must stay in sync both ways
   (`pnpm run doc-lint`, `scripts/doc-lint.ts`, wired into the `check` chain).
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
   - **leaked-delimiter scan**: a third check reads every git-tracked `.md` in
     the repo and fails if a stray tool/XML delimiter (the closing `content` or
     `invoke` tags of the round-1 audit C1 leak) survived into committed prose,
     so stray agent-output markup can't ship in the docs.
   Failure output names the identifier, which side is missing it, and which file
   to fix.

5. **Third-party actions are pinned by full commit SHA.** Every `uses:` in every
   workflow under `.github/workflows/` references an immutable commit
   SHA, never a mutable tag like `@v4` — a tag can be force-moved onto malicious
   code under an unchanged CI config. A trailing comment records the
   human-readable version the SHA resolved to (`# v4.3.0`, `# v4.4.0`; a
   comment may also record just the major line the pin tracks, like `# v1`
   for `claude-code-action` pinned at its `v1.0.181` release commit); bumps
   come through the same
   Dependabot/Renovate PRs as dependencies and pass both gates.

Direction note (owner decision, 2026-07-20, DECIDE F1): the **REVIEW+AI** tier
that architecture.md's enforcement matrices reference is commissioned as a
**full AI-review CI gate** — not a transitional PR-template checklist. Its
scope and wiring are their own upcoming package; until it lands, REVIEW+AI
cells name a commissioned gate, not a shipped one.

## Consequences

- Every PR is marked red until the required gates pass. The remote smoke script
  supports explicit production verification with SHA attestation.
- **Branch protection is server-enforced since 2026-08-15.** This fork is a
  public repository, so rulesets work on GitHub Free: `protect-main-history`
  and `require-gates` (PR + one approving owner review + the four required
  checks, no bypass) gate `main` (FOUNDATION.md). The upstream foundation's
  two-ruleset wall (described in
  [architecture.md](../architecture.md) §Environments) records the pattern
  this wall adapts.
- CI has no canonical-repository guard, so the static, runtime, browser, and
  visual jobs run wherever the workflows are enabled.
- The `smoke` job needs a Postgres service container in CI, but no
  `docker compose`: `smoke.ts` creates and drops its own isolated
  `agentproofarch_smoke` database over the provided `DATABASE_URL`, so a bare
  `postgres:16` service on `localhost:5432` is sufficient.
- Config-regression and doc-lint probes add maintenance surface (fixtures must
  track the rules they guard), accepted as the price of making "you cannot
  silently disable a rule" a mechanical guarantee rather than a hope.

## Remote smoke target

- **Production only.** Verification drives the user-facing alias; previews are
  excluded (Vercel Authentication — see FOUNDATION.md).
- **Because it drives live production, `smoke:remote` obeys the production
  smoke-account doctrine** — a dedicated canary tenant, never `db:seed` against a
  real database, caller-supplied credentials, and a non-self-poisoning drive that
  parks every card in an unbounded column. The caller must serialize runs that
  share a canary tenant.
