# ADR-0003: Vercel environments — dev, staging, prod + previews on Hobby

Status: accepted (2026-07-14)

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
   for parity). All three deployed classes are verified by `post-deploy-smoke`
   (production via the alias, previews/staging via their deployment URL).
2. **One Neon project, branch per environment**: `production`, `staging`, and
   an **ephemeral branch per preview PR** created by the Neon⇄Vercel
   marketplace integration (copy-on-write from `production`'s parent, deleted
   with the PR). `DATABASE_URL` is injected per environment by the
   integration; `DB_DRIVER=neon-http` everywhere on Vercel.
3. **Migrations at build time.** The Vercel build runs
   `db:migrate` against the environment's own database before building the
   SPA. Previews therefore always test the PR's schema on a disposable
   branch. Staging/prod migrations are forward-only; destructive changes ship
   expand → contract across two deploys.
4. **Entry**: `demo/api/index.ts` exports a node-style handler through
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
   The `DOMAIN_PROVISIONER` stays `noop` until then.
7. **Remote runtime gate**: `smoke:remote` reuses the smoke CLI suite against
   a deployment URL (health → sign-in → todos → negative case), replacing the
   boot-a-server phase with the deployed target.

## Consequences

- $0 fixed cost; the whole matrix (3 envs + previews) runs on free tiers.
- Hobby limits accepted: no Custom Environments, single-member team,
  non-commercial use — fine for the foundation demo; upgrading to Pro changes
  configuration, not architecture.
- Build-time migrations couple deploy and migrate; the expand→contract rule
  and Neon's instant branch restore are the mitigations. Revisit if a real
  product needs decoupled migration gates.
- Web multi-tenancy is unexercised on previews until a wildcard domain
  exists; the CLI/X-Tenant path keeps it covered by `smoke:remote`.
