# Provider-coupling audit

Date: 2026-07-11. Trigger: the "tenant = Better Auth organization" discovery
during the ADR-0002 review. This is the full sweep of the architecture and the
demo for similar hidden assumptions, with priorities and fixes.

Priorities: **P0** = decision encoded in docs now (this PR) · **P1** = fix in
the demo migration PR (one batch) · **P2** = document / lint, low urgency.

| # | Coupling | Where | Prio | Fix |
|---|---|---|---|---|
| 1 | Tenant IS a Better Auth organization; creating a tenant calls the auth provider | `adapters/db/app-schema.ts` (FKs to `organization`), seed, CLI/web org flows | P0 docs ✔ / P1 code | Foundation-owned `tenants` table; move FKs; tenant creation = our use-case |
| 2 | Staff roles read from provider `member` table | `adapters/db/repositories.ts` (`MembershipReader` joins `member`+`organization`) | P1 | Our `tenant_admins` (flat owner/admin); same reader port, new implementation |
| 3 | `roleSchema = owner\|admin\|member` mixes staff and customers in one enum | `core/domain/identity.ts` | P0 docs ✔ / P1 code | Staff roles = `owner\|admin`; customers are `members` rows, not a role; `Identity` gets `staffRole` + `memberId` |
| 4 | `Identity` produced with a single `role`; docs said it comes from `AuthPort` | `core/server/usecases/resolve-identity.ts`, PRD §3.4 | P0 docs ✔ / P1 code | `AuthPort` yields the user; core builds `Identity { staffRole, memberId }` |
| 5 | Foundation tables FK provider tables (`user.id`, `organization.id`); member email was to be exported "via join to the account" | `adapters/db/app-schema.ts`; ADR draft | P0 docs ✔ / P1 code | `userId` opaque string, no FKs into provider tables; `members.email` owned snapshot — export/marketing never join the provider |
| 6 | CLI calls provider endpoints directly (`/api/auth/sign-in/email`, `set-auth-token` header) | `apps/cli/src/main.ts` | P0 policy ✔ / P1 code | Auth flows only through `AuthClientPort` implementations; CLI gets its own port binding instead of raw fetches |
| 7 | Web auth adapter loads the provider `organizationClient` plugin | `adapters/auth/client-adapter.ts` | P1 | Drop the plugin; port implementation = identity + auth methods (magic link, social, passkeys, 2FA) only |
| 8 | `/api/auth/*` is an opaque, contract-undocumented surface any code could call | `apps/server/src/app.ts` | P2 | Keep mounted (it is the adapter's HTTP surface); add lint forbidding the `api/auth` string outside `adapters/auth` |
| 9 | `trustedOrigins` is a static env-derived list — custom tenant domains cannot sign in | `apps/server/src/composition.ts` | P1 | Dynamic resolver against verified `tenant_domains` (required for per-domain magic links) |
| 10 | "Registration creates a personal default organization" semantics | PRD (old FR-7), demo flow | P0 docs ✔ / P1 code | Explicit flows: creator creates a tenant (owner row); customers arrive via `ensureMember` |
| 11 | Auth schema generated with the organization plugin | `adapters/auth/auth.generate.ts` | P1 | Regenerate without the plugin; drop `organization/member/invitation` tables and `session.activeOrganizationId` |

Verified clean (no action): tenant resolution never uses the provider's
`activeOrganizationId` (host header + our tables only); `core/**` has zero
provider imports (lint-enforced); DB drivers and domain provisioning sit
behind ports; cookie configuration lives in the adapter.

The P1 batch is one migration PR against `demo/`: strip the organization
plugin, add `tenants`/`tenant_admins`/`members` tables, re-point FKs, swap the
membership reader implementation, rebind CLI auth through the client port,
make `trustedOrigins` dynamic, regenerate the auth schema, update the seed.

> **Landed (2026-07-20).** The P1 batch is complete. `demo/` ships
> foundation-owned `tenants`, `tenant_admins` and `members` tables
> (`adapters/db/app-schema.ts`), the Better Auth organization plugin is
> removed, tenancy no longer touches any provider organization/member table,
> and the CLI authenticates through the client port. The remaining P2 items
> (documentation/lint, e.g. the `api/auth` string ban) are tracked separately.
