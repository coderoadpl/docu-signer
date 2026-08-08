# Foundation deltas

## Provenance

- Upstream: <https://github.com/chomamateusz/agentproofarch> (the `demo/`
  subtree is this repo's root).
- Forked commit: `32e2d34` (upstream main, 2026-07-27 — the wholesale
  re-transplant in PR #2); the layout layer from upstream PR #86 (through
  `cf247d1`) was ported on top the same day in PR #3.
- Foundation-owned paths (per architecture.md §Consumption model):
  `eslint.config.js`, `eslint-plugin-agentproofarch/`,
  `.dependency-cruiser.cjs`, `tsconfig.json`, `scripts/doc-lint.ts`,
  `scripts/smoke*.ts`, `config-regression/`, `core/` layering,
  `.github/workflows/`. A foundation update is `git diff 32e2d34..upstream`
  over those paths.

This repo is a fork of the agentproofarch demo foundation, scaled for what it
is: a non-commercial document archive for 2 trusted users (owner ruling
2026-07-27). The structural rules hold in full — layer boundaries, lint gates,
no false claims in docs, `check`+`smoke` green — but ceremony does not graduate
without a named trigger: no new ADRs below the "a decision someone might one
day reverse" bar, no preview=staging doctrine. When pattern-fidelity and
simplicity conflict, simplicity wins and the delta is recorded here, one line
each.

## Conscious deltas from agentproofarch

- Self-host stack dropped (Dockerfile, compose.prod, Caddyfile, ops/) — deploy
  target is Vercel + Neon + Blob only.
- No branch rulesets — GitHub Free private repo; gate discipline is
  procedural (agent merges only on green checks and the owner's word).
  architecture.md §Environments still describes the upstream ruleset wall —
  read it as the substituted-for pattern, not this repo's state.
- Remote post-deploy smoke runs on Production only — previews sit behind
  Vercel Authentication, whose SSO interstitial an unauthenticated smoke
  cannot pass; staging-by-preview verification is deliberately waived.
- One shared Neon database and Blob store across Production and Preview — no
  per-preview branch databases.
- Admin accounts self-seed at deploy time from `SEED_ADMIN{1,2}_*` env
  (`db:seed:deploy` in `vercel-build`); env is the source of truth for their
  passwords.
- Registration closed in production via `AUTH_DISABLE_SIGNUP`; single tenant
  `default`; `TENANT_CREATION=closed`.
- ai-review gate budget set by repo variables (`claude-opus-5`, 120 turns,
  90 min).
- Migration lineage reset wholesale at the skeleton migration (architecture.md
  §Environments owner ruling); forward-only binds from that merge onward.
- Login hides demo credentials and magic-link controls outside dev/e2e builds
  until SMTP exists in production.
- A single Material theme and sidebar shell replace the upstream logbook look
  and top navigation (owner decision 2026-07-27).
