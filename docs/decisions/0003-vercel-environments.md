# ADR-0003: Vercel environments — dev, staging, prod + previews on Hobby

Status: accepted (2026-07-14); **release and storage topology superseded
(2026-07-24, 2026-07-27)** — see note below and
[architecture.md](../architecture.md) §Environments (normative).

> **Superseding notes (2026-07-24, 2026-07-27).** Decision point 1's release
> mapping has changed: **staging is now `main`** (its Preview on a stable URL), and
> **production is a dedicated `production` branch** with Vercel Production Branch
> Tracking set to it. The long-lived `staging` branch relic is deleted. A
> production release is an **owner-approved PR `main → production`** whose merge
> triggers the production build — gated upstream by the `production-protection`
> ruleset, procedurally in this fork (no rulesets; FOUNDATION.md); agents act
> as a Write-not-Admin machine account. This fork also supersedes point 2:
> Production and Preview use one shared Neon database and Blob store, with no
> per-preview branches ([FOUNDATION.md](../../FOUNDATION.md)). Build-time
> migration/admin bootstrap (point 3), entry/routing (point 4), Frankfurt
> co-location (point 5) and the single-tenant `*.vercel.app` constraint (point
> 6) remain. Everything below records the original decision; where a point was
> superseded (release mapping in point 1) or rewritten to fork reality
> (storage in point 2), this note and FOUNDATION.md are authoritative.

## Context

The foundation names Vercel as the default deploy target but never defined the
environment model. We want dev / staging / prod plus per-PR previews, at zero
fixed cost (Vercel Hobby + Neon Free), without fighting the platform.

## Decision

1. **Map onto Vercel's native model instead of inventing one.** Vercel knows
   three env classes (Production / Preview / Development). Production = `main`.
   Staging = a long-lived `staging` branch whose deployments are Previews;
   branch-scoped environment variables remain available on Hobby if staging
   ever needs to diverge, but none are required: previews and staging derive
   their base URL and trusted auth origin from the platform-injected
   `VERCEL_URL`/`VERCEL_BRANCH_URL`, so every non-production deployment is
   fully functional (including sign-in) with zero per-branch configuration.
   Every PR gets a standard Preview. Development is local (`vercel env pull`
   for parity). Production deployments are verified by `post-deploy-smoke`
   via the production alias; previews sit behind Vercel Authentication and
   are not remotely smoked (see FOUNDATION.md).
2. **One shared Neon database and Blob store across deployed environments.**
   Production and Preview receive the same platform-managed `DATABASE_URL` and
   `BLOB_READ_WRITE_TOKEN`; this fork does not configure per-preview Neon
   branches. `DB_DRIVER=neon-http` everywhere on Vercel.
3. **Migration and admin bootstrap at build time.** The Vercel build runs
   `db:migrate`, then the admin-only `db:seed:deploy`, against that shared
   database before building the SPA. The deploy seed creates no demo data and
   is a no-op unless the `SEED_ADMIN1_*` pair is configured. All deployed
   migrations are forward-only; destructive changes ship expand → contract
   across two deploys.
4. **Entry**: `api/index.ts` exports a node-style handler through
   `@hono/node-server/vercel` (with `NODEJS_HELPERS=0`, see PRs #11/#15);
   `vercel.json` routes `/api/*` to the function and everything else to the
   static SPA build with an SPA fallback. Root directory = `demo`.
5. **Function and database are co-located in Europe**: the function runs in
   `fra1` and the Neon project lives in `aws-eu-central-1` (resource
   `neon-frankfurt`). Cross-continent pairing is a known failure mode — the
   original us-east-1 database forced the function to `iad1` as a stopgap
   (PR #12) until the database was migrated to Frankfurt on 2026-07-17.
   Rule: whoever moves one side moves both.
6. **No custom domain yet** (accepted constraint): web is single-tenant on
   `*.vercel.app`; API/CLI remain fully multi-tenant via `X-Tenant`. Attaching
   a wildcard domain later changes env vars (`APP_BASE_DOMAIN`), not code.
   The `DOMAIN_PROVISIONER` switch is live: `caddy` (US-021) for the Docker
   self-host target and `vercel` (US-020) for this one — the Vercel adapter
   attaches each tenant host to the project over the Domains API. This
   deployment stays on the `noop` default until the owner sets `VERCEL_TOKEN` +
   `VERCEL_PROJECT_ID`, which is also when the adapter first runs live.
7. **Remote runtime gate**: `smoke:remote` reuses the smoke CLI suite against
   a deployment URL (health → sign-in → todos → negative case), replacing the
   boot-a-server phase with the deployed target.

## Consequences

- $0 fixed cost; the whole matrix (3 envs + previews) runs on free tiers.
- Hobby limits accepted: no Custom Environments, single-member team,
  non-commercial use — fine for the foundation demo; upgrading to Pro changes
  configuration, not architecture.
- Build-time migration/bootstrap couples deploy and database setup; the
  idempotent admin-only seed, expand→contract rule, and Neon instant restore are
  the mitigations. Because Preview shares the live store, preview builds do not
  provide database isolation. Revisit if the two-trusted-user scale changes or
  a real product needs decoupled migration gates.
- Web multi-tenancy is unexercised on previews until a wildcard domain
  exists; the CLI/X-Tenant path keeps it covered by `smoke:remote`.
