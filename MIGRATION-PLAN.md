# Migration plan: podpisy → current agentproofarch skeleton

Status: PLAN — awaiting owner decisions (see "Open decisions"). Prerequisite met:
PR #1 merged to `main` (`32591db`, 2026-07-27).

Analysis artifacts (generated 2026-07-27, Codex sol/luna, verified spot-wise):

- `~/repositories/claude-tmp/podpisy-migration/upstream-analysis.md` — per-PR
  inventory of upstream drift with MUST-TAKE/NICE-TO-HAVE/SKIP tags.
- `~/repositories/claude-tmp/podpisy-migration/conflict-map.md` — downstream
  changes vs upstream changes, 30-file both-modified conflict set.

## Facts

- Transplant base verified: `agentproofarch@66eb7c1` (demo/), byte-identical for
  135/141 files; transplant deviations: `README.md`, `apps/web/index.html`,
  `package.json`, `package-lock.json` (name only), `scripts/doc-lint.ts`
  (docs root), removed `.env.example`.
- Upstream HEAD `32e2d34` (2026-07-27): 37 demo-touching PRs, 289 files,
  +43k/−13k. Headline shifts: npm→pnpm 10 (PR #81), Node 22→24 (#71), Zod 3→4
  (#50), default-deny authorization with mandatory `Ctx` first arg (#36, #77),
  island-core web architecture + 3 custom lint rules (#26, #27, #33, #34),
  knip + expanded config-regression probes (#35), drizzle migrations 0002–0008
  + migration-lint (#48), e2e grown to 6 specs, Mailpit/SES email, passkeys/2FA/
  magic-link, members/staff/cards/team-board example verticals, Docker/Caddy
  self-host, ops/backup.
- Downstream (F1, now in `main`): documents vertical (26 new files), 30 modified
  skeleton files — exactly the shared wiring files upstream also rewrote.
- Upstream CI workflows live at the upstream repo root (never transplanted);
  podpisy has **no `.github/`** today. Major upstream jobs are gated
  `if: github.repository == 'chomamateusz/agentproofarch'`.

## Strategy: re-transplant + re-apply (not patch-merge)

Rejected: applying `66eb7c1..32e2d34 -- demo` as a patch onto podpisy. No shared
git history, 289 changed files vs our 30-file conflict set, and the conventions
our code must be rewritten to (Ctx/authorize, Zod 4, pnpm, lint rules) changed
anyway — a patch-merge ends up rewriting the same code with worse provenance.

Chosen: copy upstream `demo@32e2d34` fresh, re-apply podpisy identity, then
re-apply the documents vertical **written to the new conventions**. The vertical
is well-bounded and its re-application follows the skeleton's own documented
resource flow. Each phase ends with green gates.

## Phases

Every phase: implementation by Codex (gpt-5.5) on a worktree
(`~/repositories/podpisy-wt-migration`, branch `feat/upstream-migration`),
green `pnpm run check` + `pnpm run smoke` (+ `e2e` at checkpoints), Opus review
before advancing. Nothing merges without owner approval.

### Phase 1 — toolchain preflight

- Node 24 via nvm (`.nvmrc` pin; local default is 25.2.1), pnpm ≥10 via corepack
  (local has 7.27.1 — too old).
- Baseline sanity: run `check` + `smoke` in `~/repositories/agentproofarch/demo`
  at `32e2d34` to confirm the target state is green on this machine before any
  porting starts.
- Check dev-compose collision: upstream named its dev stack `agentproofarch-dev`
  and probes for legacy stacks; podpisy runs `podpisy-db-1` on 47542. Rename
  podpisy's compose project (`podpisy-dev`) during Phase 2.

### Phase 2 — re-transplant

- On the worktree: replace all tracked files with upstream `demo@32e2d34`
  (preserve `.claude/`, `.agents/`, `docs/`, `skills-lock.json`,
  `HANDOFF-MIGRATION.md`, this file, `.gitignore` extras).
- Re-apply identity: package name `podpisy` (package.json + pnpm-lock),
  README/title branding, doc-lint docs root → local `docs/`. Keep
  `.env.example` this time — doc-lint now enforces env-schema coverage in it.
- Bring CI: copy upstream `check`/`smoke`/`e2e` workflows, strip the
  repository-name gates, adjust project naming. Skip ai-review, visual,
  docs-site, selfhost/docker-smoke workflows (see decisions).
- Checkpoint: `check` + `smoke` + `e2e` green = upstream parity commit.

### Phase 3 — re-apply the documents vertical (the core work)

> **DB reset required (review finding, phase 2):** the migration lineage
> diverges from old `main` at index 0002 (`0002_cool_speed` documents vs
> upstream `0002_lonely_zodiak`..`0008_passkey`). Every database ever migrated
> on pre-migration `main` (old dev volumes under the `podpisy` compose project,
> any preview DB) must be dropped and re-migrated from 0000 — never migrated
> forward. The fresh `podpisy-dev` project volume is already clean. The
> re-applied documents migration lands as `0009` on the upstream chain.

Ordered sub-steps, each leaving `check` + `smoke` green:

1. **Dependencies**: archive/storage deps (fflate, @vercel/blob, …) declared
   explicitly — pnpm no longer hoists transitives; lifecycle scripts are
   denied by default and releases <3 days old don't resolve.
2. **Domain + authorization**: `core/domain/document.ts` on Zod 4; document
   capabilities added to `core/domain/authorization.ts`; use-cases rewritten
   Ctx-first with `authorize`/`authorizeTenant` + denial tests; structural
   authorization probe must see them.
3. **Migration renumbering**: documents schema becomes `drizzle/0009_*`
   (upstream took 0002–0008); journal + snapshot; `migration-lint` green.
4. **Adapters**: documents-repository on the new repository patterns
   (atomicity gates from PR #48); storage/local-fs + vercel-blob shaped like
   the email/domain-provisioning adapter families so dependency-cruiser
   confinement passes.
5. **Server**: document/upload/export routes on the new `app.ts` structure
   (`respond.ts`, public/internal app split, health routes); re-apply F1
   hardening: content-type allowlist, per-route body limits (+ the F1
   follow-up: parity on auth routes), 25 MB cap, clean-export (PDF metadata
   strip, bulk ZIP with DOS-epoch mtimes, cap 100).
6. **Contract + client**: routes/http/queries per new patterns (cache.ts,
   error surface).
7. **Web**: documents pages on the new shell (AppLayout, routes registration),
   PL branding merged into the new LoginPage (which now carries magic-link/
   2FA/passkey sections), theme merge. Satisfy `query-descriptors-only` and
   `sx-layout-only`; island-core structure only if lint/state complexity
   forces it (upstream's TodosPage precedent stays non-island).
8. **Single-tenant + auth policy**: re-apply tenant-membership enforcement in
   `resolve-identity` on top of upstream's rewritten resolution;
   `TENANT_CREATION=closed`; keep registration closed (upstream added a public
   RegisterPage — disable/hide); seed 2 admins from `SEED_ADMIN{1,2}_*` env;
   trusted Vite dev origin.
9. **Gates coverage**: smoke additions for documents; config-regression
   coverage for archive gates (as in F1).

### Phase 4 — feature policy (config-first, minimal code)

- `DOMAIN_PROVISIONER=noop`, Sentry off (no `SENTRY_DSN`), SES off — Mailpit
  is dev-only.
- Keep passkeys + TOTP 2FA enabled (valuable for a 2-user paperless app on
  iPad). Magic-link stays dormant until a real SMTP exists at deploy time.
- Keep example verticals (todos, cards, team-board, members, staff) for now —
  smoke/e2e assume them; stripping is Phase 6.

### Phase 5 — review & merge

- Full Opus review passes (F1 pattern: iterate to MERGE-READY), final
  comment-pass on the diff, `check`+`smoke`+`e2e` green, owner approval, merge
  PR to `main`, clean up worktree.

### Phase 6 (optional, separate PR) — strip example verticals

- Remove cards/team-board (and decide todos) + adapt seed/smoke/e2e/gates
  accordingly. Deliberately after the migration is green, never during.

## Top risks (from the analysis, ranked)

1. Ctx/authorization rewrite touches every documents use-case (compile-level
   break; mitigated by sub-step 2 being early and test-first).
2. Zod 4 across all document schemas/contract parsing.
3. pnpm strictness exposing undeclared storage-adapter deps.
4. New lint/depcruise/knip/config-regression gates rejecting the archive
   layout (mitigate: shape adapters/features after upstream families).
5. Smoke/e2e assume upstream feature inventory — keep those features (Phase 4
   decision) so gate scripts port unchanged.
6. Local toolchain drift (Node 25 default, pnpm 7) — Phase 1 exists for this.
7. Dev-compose legacy-stack probe vs existing `podpisy-db-1` container.

## Open decisions (owner)

1. **Example verticals**: keep through migration, strip later in Phase 6
   (recommended) — or strip during migration (adds gate-rework risk to the
   critical path)?
2. **Auth extras**: passkeys + 2FA on (recommended); magic-link dormant until
   deploy; registration stays closed (recommended).
3. **CI scope**: carry check/smoke/e2e only (recommended); skip ai-review,
   visual, docs-site, selfhost workflows.
4. **Docker/Caddy/ops-backup assets**: keep files as inert upstream parity
   (recommended — zero cost, eases future syncs) or delete?
5. **GitHub access**: `chomamateusz-agent` still can't see `chomamateusz/podpisy`
   — add as collaborator (Write) at Settings → Access, or the migration PR has
   to be opened/managed by the owner.
