# ADR-0002: Member identity — global authentication, tenant-owned relationship

Date: 2026-07-11 · Status: accepted (owner-approved)

## Context

Two user populations exist: creator teams (fit the auth-provider organization
model) and end customers ("members" — course students, community members) who
belong to tenants and, in the future, possibly to multiple applications built
on this foundation. Hard requirements: the customer relationship belongs to
the creator (profile, tags, GDPR marketing consents stored per tenant), full
per-tenant export, one email may be a customer of many tenants, a member must
not be able to enumerate their tenants, creators can remove a member from
their own tenant only, accounts must be creatable without a password from a
payment webhook, and sessions must work across tenant subdomains and custom
domains.

## Decision

**Separate "who are you" from "who are you here".**

1. **Global account = authentication only** (email + credentials, passwordless
   allowed, magic-link sign-in). Managed by the auth provider behind a narrow,
   OIDC-shaped `AuthPort`. Provider swappability (Better Auth ↔ Clerk/Auth0 ↔
   a central OIDC instance) is a requirement; nothing but authentication may
   live on this account.
2. **Members = our tenant-scoped aggregate**, in our database, with no ports
   or adapters — plain core domain + repository. All relationship data lives
   here.
3. **No auth-provider organization/team feature is used at all** (owner
   decision, second review round). The provider supplies identity only;
   every relationship lives in foundation tables: `tenants` (our domain
   entity — creating a tenant never calls the auth provider),
   `tenant_admins` (flat owner/admin grants — the teams concept is
   deliberately postponed; multiple admins are just multiple rows) and
   `members` (customers, owning their email snapshot so export never joins
   provider tables; `userId` stays an opaque string, never a foreign key).
   Product-required auth methods (magic link, social login, passkeys, 2FA)
   are provider features required from PoC, exposed only through the ports.
   Reasons:
   (a) provider org APIs let a user list their own organizations — a privacy
   leak the requirements forbid; (b) data gravity: relationship data attached
   to provider tables makes an IdP swap a data migration — applied uniformly
   to customers AND staff, the swap now touches sign-in only; (c) provider
   org features (Better Auth/Clerk/Auth0) are mutually incompatible APIs, so
   using any of them couples us to one provider; (d) semantics and scale.
4. **Deletion is two operations**: creator removes member (member row +
   tenant data; account survives) vs user erases global account (platform-level
   GDPR request; per-tenant data remains each controller's duty).
5. **Sessions**: one session across `APP_BASE_DOMAIN` subdomains; each custom
   domain is its own cookie world — members sign in per custom domain (magic
   link on that domain), which hard-isolates sessions between tenants.
   `trustedOrigins` resolves dynamically against verified `tenant_domains`.
6. **Topology of the IdP is a composition-root decision**: embedded Better
   Auth (default; self-host stays one `docker compose up`), a separate
   container acting as OIDC provider, or a SaaS provider — all behind the
   same `AuthPort`. Not a plugin system; an adapter swap.
7. **Tenant, not instance**: one instance hosts many tenants sharing one
   account pool, so one customer account across a creator's unrelated brands
   is free within an instance. New instances are for hard isolation only.
   Cross-instance/cross-app SSO = promote the IdP to a central OIDC provider
   and swap adapters; members aggregates are untouched. Explicit non-goal of
   the foundation.

## GDPR

Creator = controller of their tenant's member data (profile, tags, consents,
progress). Platform operator = processor for tenant data; controller of the
minimal global account. Marketing consents exist only per tenant. Per-tenant
export (CSV/JSON incl. email) is a foundation capability.

## Risks acknowledged

- A future central IdP is a single point of failure for sign-in across a
  fleet; account takeover spans contexts (mitigations: email verification,
  per-domain magic links, passkeys later).
- We re-implement what the provider's org plugin gave for free (membership
  tables, invitation tokens) — a few small tables and use-cases, judged
  cheaper than coupling every relationship to one provider's API.
- The member email snapshot can go stale after an account email change.
  Querying the provider at export time was rejected: it couples the
  creator's core business asset to provider availability and rate limits
  (Auth0/Clerk management APIs throttle hard at export scale), and loses
  the emails entirely if the account or provider goes away. Instead the
  snapshot refreshes on sign-in (AuthPort already carries the fresh email)
  and via provider update webhooks; consents stay bound to the email they
  were given for.
- Self-hosted instances have independent account pools; SSO across them is a
  hosted-operator feature, not an architecture property.

## Consequences

- Foundation PRD §3.4 rewritten; FR-6/7 amended; FR-19..25 and US-025..028
  added; US-007 redefined (no organization plugin).
- Implementation debt: the demo originally modelled tenants as Better Auth
  organizations — to be migrated to foundation-owned `tenants` +
  `tenant_admins` tables. The full inventory of provider couplings, with
  priorities and fixes, lives in
  [provider-coupling-audit.md](../provider-coupling-audit.md) (docs first,
  code follows).

  > **Landed (2026-07-20).** The P1 migration batch is complete: `demo/` now
  > ships foundation-owned `tenants`, `tenant_admins` and `members` tables (see
  > `demo/adapters/db/app-schema.ts`), the organization plugin is gone, and no
  > provider organization/member table backs tenancy. This debt is resolved.
- Together PRD FR-3 should be rephrased from "isolated member accounts" to
  "isolated member relationship ownership over shared authentication".

  > **Members aggregate built (2026-07-21).** The full vertical shipped:
  > `member` domain (`core/domain/member.ts`), the `member:read`/`:write`/
  > `:remove`/`:export` capabilities, use-cases `ensureMember` (the FR-20
  > idempotent find-or-create entry point), `listMembers`, `updateMember`,
  > `removeMember`, `exportMember`, contract routes + CLI `member` verbs + a
  > staff-facing web island, with cross-tenant isolation and removal-cascade
  > integration tests and a smoke phase. Aggregate stances, recorded per the
  > §Data-conventions requirement that each aggregate state them:
  > - **Authorization**: `member:*` is STAFF-ONLY (owner|admin) — members are
  >   the end customers this aggregate is *about*, managed by staff, not editors
  >   of the roster; a customer's self-scoped read is `/api/me`, not a
  >   capability. Default-deny; `member:remove` is split from `member:write` so a
  >   later policy can reserve destructive removal for owners.
  > - **Concurrency**: last-write-wins (short-lived per-tenant rows; a lost
  >   profile edit costs a re-type, not data).
  > - **Deletion**: hard delete of the member row; today that row is the ONLY
  >   tenant-scoped data keyed by the member (todos/cards are authored by
  >   `userId`), so `removeMember` reports `deleted.members` and future
  >   `memberId`-keyed aggregates add their own counts + FK cascade. The global
  >   account is untouched (operation 1 of the two-operation deletion model).
  > - **Storage**: `members` is on the §Data-conventions GRANDFATHER list, so it
  >   stays text id + text ISO timestamps (not migrated to uuid/timestamptz); the
  >   new columns join that convention to avoid a table mixing timestamp types.
  >   New sibling aggregates keyed by `member_id` adopt uuid/timestamptz.
  >   `user_id` is now nullable: `ensureMember` provisions a member row before an
  >   auth account exists (the passwordless magic-link binding is US-026).
