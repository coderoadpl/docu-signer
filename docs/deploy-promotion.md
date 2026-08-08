# Deploy release runbook (Vercel target)

The step-by-step companion to [architecture.md](architecture.md) §Environments.
That section is normative: **production is released by the owner merging an
approved pull request `main → production`; the merge triggers the production
build, so the owner's diff review happens *before* the build that sees production
secrets.** This file is the procedure that makes that true and keeps it true.
Nothing here except opening the PR is agent-runnable — the approval and merge are
owner actions from a device the agent does not control.

Vocabulary: the **released SHA** is the commit currently serving production (read
it off `/api/health` — see [architecture.md](architecture.md) §Health & deploy
attestation). A **staging/preview deployment** is any auto-built Preview (from
`main` or a PR). A **release** is a merge of `main → production`, which builds
Production against production env vars.

## a. One-time setup: the topology and the two rulesets

Do this once per Vercel project + GitHub repo.

1. **Vercel → the project → Settings → Git → Production Branch: `production`.**
   From now on a push/merge to `main` builds a **Preview** (staging); only a
   merge to `production` builds Production. Assign `main`'s Preview a stable URL
   (Settings → Domains, or a `vercel alias`) so staging has a fixed address.
2. **Create the `production` branch** off `main` and point Production Branch
   Tracking at it (step 1). Delete any legacy `staging` branch — `main` is
   staging now.
3. **GitHub → Settings → Rules → Rulesets. Create `production-protection`**
   targeting `production`: require a pull request, **1 required approval**, merge
   method **Merge** only, required status checks **`check` / `smoke` / `e2e` /
   `docker-smoke`**, block force-pushes, restrict deletions, and an **empty
   bypass list** (no role, not even Admin, merges past it).
4. **Create `main-gates`** targeting `main`: require a pull request, **0 required
   approvals**, the same four required status checks **plus `ai-review`** (the
   fail-closed doctrine review, added 2026-07-26) **and "require branches to
   be up to date before merging"** (the concurrent-change / F2 guard), block
   force-pushes, restrict deletions, empty bypass list.
5. **Identity split.** Confirm the agent account (`chomamateusz-agent`) is a
   collaborator with **Write, never Admin**, and that no owner gh session / PAT
   lives on the agent machine. Write-not-Admin is what stops the agent editing or
   deleting either ruleset; the empty bypass list is what stops anyone else.
6. **Verify nothing but a `production` merge deploys Production.** Merge a trivial
   PR to `main`, wait for the deploy, and confirm in **Deployments** that the new
   build is tagged *Preview* (not *Production*) and that the production
   `/api/health` SHA is unchanged. If a `main` merge lands on Production, the
   Production Branch was not saved — repeat step 1.

## b. The release ritual (every production release)

Performed by the **owner**, from a device the agent does not control. Opening the
PR may be delegated to an agent; **approval and merge are not.**

1. **Open the release PR `main → production`** (agent or owner). Its diff *is* the
   diff since the released SHA.
2. **Review that diff — this is the seam defense.** Read the released SHA off
   production `/api/health`, confirm the PR's base is that commit, and read the
   whole diff. This review is the only defense at the irreducible seam (the
   merge triggers a production build that runs with production secrets) and it
   runs **before** the merge/build by construction — do not approve because the
   gates are green. Gates prove the code *runs*; the diff review proves it is
   *the code you meant to ship*.
3. **Confirm the four required checks on `production` are green on the PR**
   (`check`, `smoke`, `e2e`, `docker-smoke`; `ai-review` gates `main`, not this
   PR). The `production-protection` ruleset already blocks the
   merge until they pass; a check that "could not run" is red, not mergeable.
4. **If the diff includes a migration, take a Neon snapshot / PITR point first.**
   A constraint-adding or destructive migration can abort mid-`ALTER` against real
   data (see [architecture.md](architecture.md) §Constraint-adding migrations).
   Take a Neon branch-from-timestamp restore point on the `production` branch and
   note it, so a bad migration is a one-command rollback, not an incident.
5. **Approve and merge the PR.** The approval is the release gate (the agent
   cannot self-approve its own PR, and no other identity can approve). Merging to
   `production` triggers the Production build against production env vars.
6. **Verify the post-deploy SHA attestation.** Confirm production `/api/health`
   now reports the merged commit's `sha`, and that `smoke:remote` ran green for
   it (the `EXPECTED_SHA` equality in
   [../.github/workflows/post-deploy-smoke.yml](../.github/workflows/post-deploy-smoke.yml)).
   Because a `production` merge is an ordinary branch push, it emits the normal
   `deployment_status` for the `Production` environment, so the workflow fires as
   usual.

**Rollback** is a release in reverse: open and merge a PR that reverts
`production` to the previous known-good SHA (or `git revert` the offending
commit), through the same approval gate. A migration in the rolled-back release
is undone via the Neon PITR point taken in step 4, not by shipping older code —
code rollback and schema rollback are separate (old code against a new schema can
still break).

## c. The five standing controls — checklist and WHY

Each is a property of the environment, not a rule an agent is asked to remember.

1. **Owner-approved PR is the only path to production.** Production Branch
   Tracking points at `production`, guarded by the `production-protection`
   ruleset (PR + 1 approval, empty bypass, four required checks). *WHY:* agents
   have full `main` freedom by design; the wall is that the merge which triggers a
   production build needs an approval the agent cannot supply — GitHub forbids
   self-approval, the agent is Write-not-Admin so it cannot edit the ruleset, and
   an owner SSH key can push a ref but cannot approve a PR or edit a rule via the
   API. The review lands **before** the secret-exposed build, which is the whole
   point.
2. **Zero platform-CLI sessions on agent machines + Bash-hook ban.** No
   `vercel`/`neonctl`/cloud-CLI login persists on any machine an agent drives, and
   the agent harness's Bash hook denies launching them. *WHY:* a logged-in CLI is
   a standing credential to production infra; a blocked command is enforcement, a
   documented "please don't" is not.
3. **All production env vars marked Sensitive (write-only).** In Vercel's env UI,
   every production variable is set Sensitive so its value cannot be read back,
   only overwritten. *WHY:* limits blast radius if a session or export is
   compromised — secrets are entered once by a human and never re-exfiltrated
   through the dashboard/CLI read path. (The build itself still *sees* them —
   §Environments "irreducible residue"; this control bounds the read path, not the
   build.)
4. **Passkey / 2FA on the Vercel login; sessions only on owner devices.** *WHY:*
   the login is the single gate to the secret store; phishing-resistant auth on it
   is the account-takeover defense.
5. **Platform-independent DR.** Cold standby on the owner's VPS via the Docker
   deploy target, an hourly `pg_dump` cron on the VPS, and Neon PITR. *WHY:* the
   whole topology assumes Vercel + Neon; a total-platform loss (account
   suspension, provider outage) must be recoverable off both — the same commit
   deploys to Docker + Postgres, and the hourly dump bounds data loss independently
   of Neon's own retention.

Operating-hygiene context for these lives in
[../demo/README.md](../demo/README.md) §Operating hygiene for agent-driven repos.

## d. What agents may do

**Everything on `main`, nothing that releases production.** Agents (acting as
`chomamateusz-agent`, Write) branch, open PRs, merge to `main` once the four
checks pass, dispatch workflows, and drive preview + staging deployments freely —
that is the whole development environment. An agent may **open** the
`main → production` release PR, but cannot approve it (no self-approval), cannot
edit the rulesets (Write, not Admin), and holds no platform-CLI session. Approval
and merge to `production` are the owner's, from a device the agent does not
control, always.
