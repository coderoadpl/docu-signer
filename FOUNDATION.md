# Foundation deltas

## Provenance

- Upstream: <https://github.com/chomamateusz/agentproofarch> (the `demo/`
  subtree is this repo's root).
- Forked commit: `32e2d34` (upstream main, 2026-07-27 — the wholesale
  re-transplant in PR #2); the layout layer from upstream PR #86 (through
  `cf247d1`) was ported on top the same day in PR #3; the upstream v1.2.0
  account-management slice (password change/reset) was ported on 2026-08-02.
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
- Branch rulesets armed 2026-08-15: `protect-main-history` (no deletion, no
  force-push, no bypass) and `require-gates` (PR with one approving owner
  review + required checks `check`/`smoke`/`e2e`/`ai-review`, merge commits
  only, no bypass). Owner ruling 2026-08-15 adopts the Together-style
  promotion wall and REVERSES the earlier autonomous-merge delta: the agent
  prepares PRs and the approving review is the owner's release decision. The
  owner first ruled the merge click personal („Merguję osobiście"), then
  reversed that mechanic the same evening: once the owner's approval and the
  four green checks are in place, the agent MAY execute the merge
  (`gh pr merge --merge`) — both rulings archived verbatim in
  [docs/owner-rulings.md](docs/owner-rulings.md). Stale approvals are
  dismissed on every new push
  (`dismiss_stale_reviews_on_push`), so the owner's review always covers the
  exact snapshot that merges — that is what makes "the diff review happens
  before the production build" an enforced property, not a convention.
  `require_last_push_approval` stays off because branches are pushed
  over the owner's SSH identity, which would make the owner the pusher and
  void their own approval. Ruling archived verbatim in
  [docs/owner-rulings.md](docs/owner-rulings.md).
  architecture.md §Environments still documents the upstream two-ruleset wall
  (including a `production` branch) — read it as the pattern this fork's
  `main`-only wall adapts.
- A long-lived `staging` integration branch batches feature PRs (owner ruling
  2026-08-15 late: the agent merges PRs into `staging` on green
  `check`/`smoke`/`e2e`; `ai-review` deliberately runs only on PRs targeting
  `main`, so Opus reviews the whole batch once on the collective
  `staging → main` promotion PR, where the owner-approval wall applies).
  `staging` deployments are Vercel Previews; production still releases only
  from `main`.
- Since 2026-08-16, Vercel previews build only for branches with an open PR and
  commits touching the app, enforced by `ignoreCommand` through
  `scripts/vercel-ignore-build.mjs`; production and `staging` always build.
- Production deploys from `main` (Vercel tracks `main`); the upstream
  `main → production` promotion stage is collapsed into the owner-review wall
  on `main` itself — there is no `production` branch in this fork.
- Remote post-deploy smoke runs on Production only — previews sit behind
  Vercel Authentication, whose SSO interstitial an unauthenticated smoke
  cannot pass; staging-by-preview verification is deliberately waived.
- One shared Neon database and Blob store across Production and Preview — no
  per-preview branch databases.
- Env-seeded accounts are retired in favor of invitations; `db:seed:deploy`
  creates one bootstrap owner from `SEED_ADMIN1_*` only when the database has
  zero users, then becomes a permanent no-op (Together-pattern first-run bootstrap).
  PR #74 was reverted on 2026-08-10 for a misattributed login outage and re-landed
  the same day with a post-deploy browser login probe.
- The deploy seed binds `APP_BASE_DOMAIN` to the default tenant because the web
  shell is single-tenant per domain.
- Registration closed in production via `AUTH_DISABLE_SIGNUP`; single tenant
  `default`; `TENANT_CREATION=closed`.
- ai-review gate budget set by repo variables (`claude-opus-5`, 120 turns,
  90 min).
- Migration lineage reset wholesale at the skeleton migration (architecture.md
  §Environments owner ruling); forward-only binds from that merge onward.
- Login hides demo credentials and magic-link controls outside dev/e2e builds.
- Password reset is hidden until SMTP or SES is configured; dev/e2e use Mailpit.
- Merges to `main` land as merge commits (GitHub UI or `gh pr merge --merge`)
  only after the owner's approving review; the ruleset blocks direct SSH
  pushes to `main`. The prior SSH-merge delta's Vercel-Hobby author concern
  (Hobby refused deploys of commits authored by an unconnected account) is
  retired empirically, not by construction: the project moved to the paid
  Vercel team, and on 2026-08-15 three agent-authored merge commits deployed
  to production without issue.
- Remote post-deploy smoke drives the unauthenticated surface only (headers,
  the public API of the `default` tenant, health, deploy attestation) until
  the owner provisions a canary account and the `SMOKE_EMAIL`/`SMOKE_PASSWORD`
  repo secrets (`SMOKE_TENANT` only if the canary lives outside `default`) —
  production deliberately has no demo account the upstream defaults assume.
- A single Material theme and sidebar shell replace the upstream logbook look
  and top navigation (owner decision 2026-07-27).
- The shell and system states are Polish-first, including upstream demo surfaces.
- Upstream demo verticals removed; only documents and account settings remain (owner decision 2026-08-01).
- Hand-drawn PDF signatures are flattened client-side into new archive files. Owner ruling 2026-08-07 REVERSES the 2026-08-01 decision that signature ink is never stored separately: with a tenant setting (on for the single live tenant), each signing session stores its signature ink per document so the same document's signatures can be re-flattened onto a corrected source (planned "Uaktualnij źródło"). The stored ink is bound to one document by foreign key and no surface applies it elsewhere; provenance: the owner's confirming ruling, archived verbatim in [docs/owner-rulings.md](docs/owner-rulings.md). Additive precision from the 2026-08-09 owner spec records the contributing account on each new stamp, including authenticated remote-pad ink, while legacy records retain session-level attribution.
- Server-side PAdES sealing after the browser has flattened and uploaded a `signed-digital` PDF is a sanctioned artifact touch (owner ruling 2026-08-09); source replay uploads use the same post-upload step, while client-side flattening remains the signing engine.
- Documents can be marked "not requiring a signature" (documents.signature_not_required, owner request 2026-08-15): excluded from the needs-signature filter and mass-signing queues, own filter value and gray chip, bulk pair + CLI `document waive-signature|require-signature` mirroring approve/unapprove.
- Document types are a tenant dictionary seeded with the legacy five; the domain enum is gone (owner decision 2026-08-16).
- A visible first-page signers annotation is sanctioned behind a tenant flag that defaults off (owner rulings 2026-08-15 and 2026-08-16). Re-signing a signed-digital file redraws its complete chronological signer history plus the current session over the prior box at the same fixed top-right anchor; incomplete or unavailable signature records leave the baked box untouched.
- PDF organization-seal evidence is stored with the signature record. Tryb dat uses either the user-entered document signing date plus the sealing wall-clock time (`declared`) or the true wall clock (`actual`), while the true sealing wall clock is always retained in the database and never rendered. This is an eIDAS-positioned organization seal and SES evidence layer, not a qualified signature; declared time is signer-claimed and has no TSA (owner ruling 2026-08-09).
- PAdES seal metadata has two explicit layers: the certificate CN remains the certified organization identity, while English signature-dictionary metadata carries the signer-claimed display names of the people who contributed ink and does not change the certificate identity (owner ruling 2026-08-15).
- The owner's [2026-08-09 confirming ruling](docs/owner-rulings.md) records both rulings directly: PAdES seal storage is behind a tenant flag that defaults off, and Tryb dat offers declared/actual time with declared as the default.
- The fresh-clone `quickstart:probe` and its CI step were removed with the demo
  verticals they drove; the README quickstart is now convention, not enforced.
- `scripts/backup.ts` is a sanctioned standalone composition site because the cron backup runs without the server.
- The nightly backup cron moved out of this public repo into the private `docu-signer--backup` repository, which checks out this repo and runs `scripts/backup.ts` — backup secrets and Actions logs stay off the public surface (owner ruling 2026-08-15).
- The user-preference resource consciously skips the CLI step of the 12-step chain: column preferences are a web-view concern with no CLI surface to configure.
- API token `lastUsedAt` renders in Konto > Tokeny API despite the no-storage-timestamps rule: token hygiene is that security surface's purpose (agent decision 2026-08-02; owner may veto).
- Document comment `createdAt` renders beside the comment because it records the user action of posting (owner request 2026-08-16); no other document storage timestamp is exposed.
- Draft-scoped API tokens create draft document links and comments awaiting human approval; the draft state is visibility-only and supersedes the transiently shipped unrestricted annotation writes (owner decision 2026-08-16).
- Draft-scoped API tokens propose document metadata changes for human approval or rejection; documents with any pending draft source show a title dot and are searchable with the pending-drafts filter (owner decision 2026-08-16).
- Remote pad access supports fragment-secret and identity joins. Private sessions stay same-account-only; shared sessions let any account in the same tenant join without consuming or superseding that participant's own per-user host-session slot, and queue server-attributed submissions for deliberate desktop placement (owner decisions 2026-08-04 and 2026-08-09).
