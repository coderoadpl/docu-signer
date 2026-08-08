# ADR-0006: Public read-only contract surface — built shape and stances

Date: 2026-07-21 · Status: accepted
Implements: US-028, FR-23, FR-24 · Builds on
[ADR-0001](0001-public-surface-embeds-over-pages.md) (public surface = headless
API, not hosted pages).

## Context

ADR-0001 committed the foundation to a headless public surface: unauthenticated
read-only JSON, open CORS, cacheable with tenant-content versioning, consumable
from any creator-hosted site. Until this package the `no-store` default at the
`respond()` seam was the whole cache policy and no public route existed. This ADR
records the built shape and the non-obvious stances chosen while building it.

## Decision

1. **A structurally distinct route group.** Public routes live in their own
   `PUBLIC_API_ROUTES` registry in `core/contract` under the `/api/public/*`
   prefix, separate from `API_ROUTES`. The demo route is the public tenant
   profile — `slug`, `displayName`, `contentVersion` only; never emails, members,
   staff or todos. Two routes: a short-cached **discovery**
   (`GET /api/public/tenants/:slug` → `{ slug, contentVersion }`) and a
   long-cached, version-keyed **profile**
   (`GET /api/public/tenants/:slug/v/:version`).

2. **Authorization stance — before identity, never authorize.** Public handlers
   are registered ahead of the `/api/*` tenant-resolution middleware and call
   only `getPublicTenantProfile`, a use-case that takes **no** `ctx: { identity }`
   and runs no `authorize`. A public reader is not authenticated, so modelling the
   read as a `visitor` capability would be dishonest (`visitor` is an
   authenticated tenant-less principal). The default-deny capability model is left
   untouched — public reads sit *outside* it by construction. A config-regression
   probe asserts the public app references no identity-bearing use-case and that
   the public use-case is not `ctx: Ctx`-shaped (the US-028 acceptance criterion).

3. **Content version — derived, not stored.** `tenantContentVersion` is a pure
   FNV-1a (32-bit, base36) derivation over the tenant's visible public fields
   (`slug`, `name`). **Tradeoff:** the alternative — a `content_version` column
   bumped on every tenant-visible write — buys monotonicity and survives hashing
   pressure as the visible surface grows, at the cost of a migration plus
   write-path plumbing on every mutating use-case. A cache key only needs "different
   content ⇒ different key", which a pure derivation gives for free: a future
   tenant-rename use-case busts the edge cache with zero extra code. We chose the
   derivation for this package and will switch to a stored column the day the
   visible surface outgrows a cheap hash or needs monotonic ordering.

4. **The version is a cache key, not a content selector.** The profile route
   returns *current* content and echoes the *current* version regardless of the
   `:version` in the path; a consumer that requested a stale key sees the bust in
   the body and re-discovers. The key's format is validated (base36) so a junk key
   is a `400`, never a cached garbage entry.

5. **One cache helper, errors always `no-store`.** `publicCacheControl`
   (`core/contract/cache.ts`) is the only place a public `Cache-Control` string is
   built; a probe asserts the `s-maxage`/`stale-while-revalidate` tokens appear
   nowhere else. It is applied at the shared `respond()` seam, which pins errors to
   `no-store` regardless of the requested value.

6. **CORS on the public group only.** `hono/cors` (`origin: '*'`, `GET` + preflight)
   is mounted on `/api/public/*` alone; the authenticated `/api/*` surface stays
   CORS-closed. A probe asserts the authenticated app imports no CORS middleware,
   and `smoke` proves the separation from a foreign `Origin`.

7. **Shareability by slug (FR-24).** The profile is slug-addressed, so the same
   URL resolves identically on the apex or any tenant subdomain/custom domain —
   a superset of tenant-domain shareability, proven unauthenticated across hosts
   in tests and `smoke`.

## Consequences

- The `respond()` seam gained an optional `cacheControl` argument (default
  `no-store`); it was lifted into `apps/server/src/respond.ts` so the public app
  can share it without a circular import.
- A public, no-session CLI command (`public profile <tenant>`) exercises the
  discovery→profile flow; the CLI builds a header-less client for it.
- Shareable checkout flows, `/embed/*` widgets and the headless SDK remain
  unbuilt (post-MVP, ADR-0001).
