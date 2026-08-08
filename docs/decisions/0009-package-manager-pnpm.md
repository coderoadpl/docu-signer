# ADR-0009: Package manager — npm → pnpm, for supply-chain hardening

Date: 2026-07-26 · Status: accepted (owner decision, 2026-07-26) · Builds on
[ADR-0004](0004-no-exceptions-enforcement.md) (gates are enforcement, not
convention — `lock-lint` is one of `check`'s members) and
[architecture.md](../architecture.md) §Security, "Dependency hygiene".

## Context

The dependency posture up to this point was: a committed `package-lock.json`,
`npm ci` on every install path (CI, Docker, Vercel), `lock-lint` inside the
static gate, and an advisory `npm audit` in CI. All of it assumes the registry
hands back what its maintainers intended. 2025 showed that assumption failing at
scale, and the two headline failures failed in *different* ways:

- the **Shai-Hulud** worm (September 2025, and a larger second wave in November
  2025) propagated through **dependency `postinstall` scripts**. Installing a
  compromised version executed attacker code on the developer machine or CI
  runner, which harvested npm/GitHub/cloud credentials and used them to publish
  the same payload into further packages. The execution happened at **install
  time** — before anything imported a single line of the package;
- the **`chalk`/`debug` maintainer-account compromise** (September 2025) shipped
  its payload **inside the packages' runtime code**. It ran when the code was
  imported, and an install-time defence would not have touched it.

Those two set the honest boundary of this decision. Moving the install step to a
package manager that does not execute dependency scripts removes the *first*
vector and does **nothing** about the second: a compromised package's runtime
code still executes when the application imports it. This ADR buys the install
window, not immunity.

npm's own answer to the first vector is `--ignore-scripts`, which is all-or-
nothing (it also disables the handful of packages that genuinely need a build
step) and is a flag every call site must remember — exactly the kind of
honour-system control ADR-0004 exists to reject. pnpm ≥10 inverted the default
instead: nothing in the dependency tree runs unless it is named.

Three further properties made pnpm the choice rather than merely a hardening
patch on npm:

- **a minimum-release-age cooldown.** pnpm (10.16+) can refuse any version
  published more recently than a configured age. Both 2025 incidents were
  detected and their bad versions removed within hours to a few days, so an
  install that simply declines to be first closes most of the compromised-release
  window without anyone having to be awake;
- **strict, non-hoisted `node_modules`.** pnpm's default layout exposes only
  *declared* dependencies to the code that imports them. Phantom dependencies —
  imports that resolve today purely because npm hoisted a transitive package into
  the flat tree — stop resolving. This repo already spends effort attacking that
  class from the outside with knip and dependency-cruiser; pnpm makes the module
  resolver enforce it, which is the same move ADR-0004 makes everywhere else
  (structure over discipline);
- **content-addressable store.** Packages are stored once per machine and linked
  into each project, so installs are faster and cheaper — a direct win on the
  four required CI jobs, which each pay a cold install.

## Decision

1. **pnpm is the package manager for every npm project in the tree** — `demo/`
   (the foundation) and `website/` (Docusaurus). Both move together: keeping one
   on npm would leave two lockfile formats, two install semantics and two
   hardening stories in the same CI matrix, which is worse than either choice
   alone.

2. **The toolchain is pinned by the `packageManager` field**, exactly as the
   npm 11 pin was — `"packageManager": "pnpm@<exact.version>"`, activated through
   Corepack, with `engines` updated to match. The pin is what makes a local
   install and a CI install the same install; the version bumps like any other
   dependency, in a reviewed PR that passes both gates.

3. **Dependency lifecycle scripts stay off, and the exceptions are an explicit
   allowlist.** pnpm ≥10 does not run dependencies' `preinstall`/`install`/
   `postinstall` by default (the *project's own* scripts are unaffected). The
   packages that genuinely need a build step are named in
   **`onlyBuiltDependencies`**. That list is a security control, not
   configuration convenience:
   - it stays **minimal** — a package earns a place only by breaking a gate
     without one, never pre-emptively;
   - every addition is reviewed on its own merits in the PR that adds it, with
     the failure it fixes stated;
   - today's tree needs it only for native/binary resolution (`esbuild` and
     `unrs-resolver` are the candidates; `fsevents` is a darwin-only optional
     dependency and `msw`'s script only prints a banner). The shipped list is
     whatever a green `check` / `smoke` / `e2e` / `docker-smoke` proves
     necessary — no more.

4. **A minimum-release-age cooldown is on.** Freshly published versions are not
   installable until they have aged past the configured `minimumReleaseAge`; the
   value is measured in days, not minutes, and lives in configuration where it is
   reviewed like any other setting. **The override procedure is explicit**: an
   urgent security patch that is younger than the cooldown is taken by lowering
   the setting (or adding a scoped exclusion) **in a reviewed pull request**,
   never by a local flag on someone's machine and never silently — the lowering
   and its revert are both in the diff.

5. **The strict, non-hoisted layout is the point — no escape hatches.**
   `shamefully-hoist` and a hoisted `node-linker` are off. If an import stops
   resolving after the migration, the fix is to declare the dependency, not to
   flatten the tree back.

6. **`lock-lint` is re-targeted, not retired.** It stops validating
   `package-lock.json` under npm 11 semantics and starts proving that
   `pnpm-lock.yaml` and `package.json` agree, under **frozen-lockfile**
   semantics — the same thing every install path now enforces: a lockfile that
   would have to change fails the gate rather than being quietly rewritten.
   `pnpm-lock.yaml` is committed; `package-lock.json` is deleted.

7. **Every install path changes together**: the CI workflows (`ci`, `docs-ci`,
   `docs-deploy`, `post-deploy-smoke`, `selfhost`, `visual-baselines`) install
   with a frozen lockfile and cache the pnpm store instead of the npm cache; the
   `Dockerfile`'s builder and `prod-deps` stages install with pnpm (the
   production prune becomes pnpm's `--prod` install); Vercel builds through the
   `packageManager` pin. Any GitHub Action added to set pnpm up is pinned by full
   commit SHA like every other `uses:` (ADR-0004 §5).

8. **Vercel compatibility is proven, not assumed.** The claim "Vercel builds this
   repo with pnpm" is settled by **this PR's own preview deployment** going green
   and by `post-deploy-smoke` driving it — the same standard the platform
   contract has been held to since PRs #10–#15, where six consecutive
   static-green changes broke production. If the preview does not deploy and
   smoke, the migration does not land.

## Alternatives considered

- **Stay on npm and pass `--ignore-scripts` everywhere (rejected).** It is
  all-or-nothing, so the packages that need a build step break and the flag comes
  straight back off; and it is a per-call-site flag — the moment one workflow,
  one Dockerfile stage or one developer omits it, the vector is open again with
  nothing red to show for it. It also buys none of the other three properties
  (no cooldown, no phantom-dependency elimination, no shared store).
- **Yarn Berry / PnP (rejected).** Strictest resolution of the three, but PnP
  changes module resolution itself, which is a compatibility surface across
  Vite, Vitest, Playwright, tsx, drizzle-kit and the Vercel builder — a much
  larger blast radius than this decision is buying, for the same install-time
  guarantee pnpm gives with a conventional (if linked) `node_modules`.
- **Bun (rejected here).** Attractive on install speed, but it is a runtime
  swap dressed as a package-manager swap: the repo pins Node 24 across `.nvmrc`,
  `engines`, the Docker base image and the Vercel function runtime, and the
  gates' value comes from every environment running the same runtime. Adopting
  Bun is its own ADR, not a footnote to this one.

## Consequences

- **The `lock-lint` member of `check` changes shape.** Its subject is
  `pnpm-lock.yaml` and its semantics are frozen-lockfile. A stale lockfile now
  fails the same way in `check`, in CI, in Docker and on Vercel — one rule, four
  places, instead of npm's "reinstall and see".
- **The npm-10-vs-11 pin story is obsolete.** `demo/CLAUDE.md`'s toolchain
  paragraph — `engines.npm` `>=11 <12`, `packageManager: npm@11.16.0`, "use
  `npx -y npm@11 install`", tying the lockfile to the npm major bundled with
  Node 24 — describes a problem that no longer exists. The `packageManager` pin
  is now the whole story, and the Node pin (`.nvmrc`, `engines.node`) stands
  independently of it.
- **Corepack becomes load-bearing** for activating the pinned pnpm. It ships with
  Node 24; if a future Node line unbundles it, the fallback is installing the
  pinned pnpm explicitly in CI and Docker — the `packageManager` field stays the
  single source of the version either way.
- **Every documented command example changes** (`npm run check` → the pnpm
  equivalent) across the READMEs, `docs/`, `website/docs/`, `demo/CLAUDE.md` and
  the per-layer `CLAUDE.md` files — including the **scaffolder output**
  (`scripts/new-resource.ts`, `scripts/new-island.ts`) and the tests that assert
  on that output verbatim. Doc-lint and those assertions are what stop the sweep
  from being partial.
- **The cooldown delays urgent security patches too.** This is a real cost, not
  a rounding error: the same setting that stops a worm's first six hours also
  stops the fix for a critical advisory published this morning. The override in
  §4 (lower the setting in a reviewed PR, revert it after) is the accepted
  procedure, and it is deliberately as visible as the risk it takes on.
- **The allowlist is a standing review obligation.** `onlyBuiltDependencies` is
  the one place where the default protection is switched off by name. A list that
  grows by reflex — a package added because an install printed a warning — turns
  the guarantee back into npm's. Every entry needs a reason a reviewer accepted.
- **Phantom-dependency breakage surfaces at migration time, not later.** Any
  import that only ever resolved through npm's hoisting fails immediately under
  the strict layout. That is the feature; the fix is a declared dependency in
  `package.json`. The migration found exactly one: `observability.ts` imports
  `@opentelemetry/sdk-trace-base`, which the Docker runtime image resolved only
  because npm hoisted it out of `@opentelemetry/sdk-trace-node` — under the
  strict `--prod` tree the image failed to boot with `ERR_MODULE_NOT_FOUND`, and
  the fix was to declare it as the production dependency it always was.
- **The Docker image's `node_modules` becomes a linked tree** (a virtual store
  plus symlinks) rather than a flat directory. The multi-stage build copies the
  directory as a whole, so the links stay internal and valid — and the
  `docker-smoke` required check is what proves the runtime image still boots,
  rather than an argument that it should.
- **What this does not buy, stated plainly**: a compromised package whose payload
  lives in its runtime code still executes when the application imports it. The
  cooldown narrows the window in which such a version is installable at all, and
  `pnpm audit`'s advisory role in CI is unchanged, but neither is a runtime
  defence. This decision hardens **installation**.
