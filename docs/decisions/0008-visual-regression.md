# ADR-0008: Visual regression — Playwright screenshots with CI-rendered baselines

Date: 2026-07-25 · Status: accepted (owner-approved) · Builds on
[ADR-0004](0004-no-exceptions-enforcement.md) (enforcement, not convention) and
the flake doctrine (`demo/CLAUDE.md`: a flake is a P1 bug, never rerun-to-green).

## Context

The browser gate (`pnpm run e2e`) proves behaviour — a login lands on the ledger,
the WIP guard blocks, a card survives a reload — but it is blind to appearance.
A theme token, an MUI upgrade or a stray `sx` value can repaint the whole shell
without failing a single assertion. The one thing this repo cannot accept in
exchange for that coverage is a gate that is *usually* green: pixel comparison is
the classic rerun-to-green offender, and the doctrine forbids it outright.

So the design center is not coverage — it is **determinism**. A visual check
earns its place only if the same commit produces byte-identical screenshots on
every run; anything that cannot be made byte-identical is either masked, scoped
away, or not screenshotted at all.

## Decision

1. **Playwright `toHaveScreenshot()`, baselines committed in-repo.** The repo
   already runs Playwright over the real stack with a boot harness
   (`scripts/e2e-server.ts`) that drops, migrates and seeds an isolated database
   and serves the built bundle from `entry.node.ts`. Visual regression rides that
   harness: no new runtime, no new service, no new hosting decision. Baselines
   are PNGs in `demo/visual/__screenshots__/`, reviewed in the pull request that
   changes them — the diff is the approval.

2. **Baselines are rendered INSIDE CI (linux), never on a developer mac.**
   Screenshot bytes are a function of the OS's font stack and rasterizer, so a
   mac-rendered baseline is guaranteed to differ from the linux runner's. Two
   mechanisms enforce this rather than a README plea:
   - snapshot paths are platform-scoped
     (`__screenshots__/{platform}/{projectName}/…`), so a mac run cannot
     overwrite the linux baselines the gate compares against;
   - `ignoreSnapshots` is on for every non-linux platform, so a mac run — with or
     without `--update-snapshots` — writes nothing at all.

   Baselines are produced by the `visual-baselines` workflow (`workflow_dispatch`,
   `update: true`), which runs the suite with `--update-snapshots`, re-runs it as
   a comparison against what it just wrote, and only then uploads the PNGs as an
   artifact to be committed. The authoring run cannot gate anything (Playwright
   reports a newly written snapshot as a failure), so that second run is what
   stops a run that died before the harness booted from shipping an empty or
   partial artifact — and it is the determinism check in miniature.

3. **A separate suite, structurally isolated from the required gates.** The specs
   live in `demo/visual/` with their own `playwright.visual.config.ts`
   (`pnpm run visual`), not in `demo/e2e/`. The required check `e2e` therefore
   cannot go red because a screenshot moved — the isolation is a directory, not a
   filter someone can forget to apply.

4. **The check is NON-REQUIRED until the owner arms it.** The required checks
   (architecture §Environments) are `check` / `smoke` / `e2e` / `docker-smoke`
   on both rulesets, plus `ai-review` on `main-gates` since 2026-07-26. The
   new `visual` job is deliberately not among them: it reports, it does not block.
   Arming it is a one-line ruleset edit by the owner, made only after the check
   has a run history of green comparisons — and it is reverted the moment the
   gate flakes, because a flaky required gate is a P1 (ADR-0004 stance: an
   enforcer that cannot be trusted is worse than no enforcer).

5. **Determinism levers (the whole point).** All set in
   `playwright.visual.config.ts`:
   - `animations: 'disabled'` plus `reducedMotion: 'reduce'` — the login card's
     `settle` keyframe and every MUI transition land on their end state;
   - fixed `viewport` 1280×800, `deviceScaleFactor: 1`, `scale: 'css'` — layout
     and raster size never depend on the runner's display;
   - `colorScheme: 'light'`, `locale: 'en-US'`, `timezoneId: 'UTC'` — no
     ambient theme, no locale-dependent number/date formatting;
   - `caret: 'hide'` — a focused input's blinking caret is a two-state pixel
     region by construction;
   - `maxDiffPixels: 0` *and* `threshold: 0` — the gate is exact on both axes:
     no pixel may differ, and "differ" means any colour difference at all.
     Playwright's default `threshold` of 0.2 counts a pixel as equal until it
     has drifted a fifth of the YIQ distance, which would let a uniform theme
     shift repaint the whole image at zero diff pixels. A tolerance budget on
     either axis is a slow leak: it hides a one-pixel shift today and a real
     regression next quarter;
   - `retries: 0` — a retry that turns a screenshot green is the exact
     rerun-to-green the doctrine bans, so the suite is not given the option;
   - `workers: 1` and `fullyParallel: false` — no cross-test contention on the
     shared seeded database while a page is being rasterized.

6. **Only genuinely stable surfaces are screenshotted.** The seed writes every
   demo todo with the same `createdAt`, and the ledger orders by that column —
   the row order is a database tie, and the rendered date is the day the seed
   ran. Neither is stable, so the ledger's *list* is not screenshotted; the
   authenticated surface under test is the app shell chrome (wordmark, tenant
   switcher, staff-role chip, account email, navigation), which is fully
   determined by the seed. The remaining surfaces are the public ones: the login
   page, its error state, and the register page. Four screenshots that are
   trustworthy beat twenty that are re-baselined on sight.

## Alternatives considered

- **Storybook + Lost Pixel (rejected).** The repo has no Storybook. Adopting it
  for visual testing means adding a whole component-catalog stack — its build,
  its addon graph, its own duplicate of every component's provider wiring — as a
  *test* dependency, and then maintaining stories that drift from the real routes.
  It also tests components in isolation, which is precisely where a theme or
  layout regression hides. Lost Pixel's OSS mode leaves the baseline-hosting
  question open (its managed platform is the answer it wants), reintroducing the
  decision in-repo baselines settle for free.

- **A SaaS diffing service (Chromatic / Percy / Applitools — rejected).** Putting
  a third-party API inside a merge gate makes another company's uptime, quota and
  auth part of this repo's ability to ship, and the baselines live somewhere the
  repository cannot review or restore. Screenshot bytes are small and diffable;
  git is already the review surface.

## Consequences

- `pnpm run visual` is a no-op-ish local convenience on macOS (it drives the pages
  but compares nothing). Visual feedback for a developer comes from the CI job's
  uploaded diff artifact, not from a local run — a deliberate trade for baselines
  that mean one thing everywhere.
- An intentional UI change is a two-step pull request: land the change, dispatch
  `visual-baselines` with `update: true`, commit the new PNGs. The reviewer sees
  the before/after in the diff.
- Runner-image drift (a font package changing in `ubuntu-latest`) will one day
  redraw a baseline with no code change. That is the known cost of exactness; it
  surfaces as a red *non-required* job, is re-baselined deliberately, and is the
  reason the check is not armed by default.
