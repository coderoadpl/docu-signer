# ADR-0010: Tenant-creation policy — an env-selected `TENANT_CREATION` mode

Date: 2026-07-26 · Status: accepted (owner-approved) · Builds on
[ADR-0002](0002-member-identity-and-idp.md) (one global account pool, per-request
identity resolution) and the capability model in
[architecture.md §Authorization](../architecture.md#authorization).

## Context

`tenant:create` is today granted to three principals
(`core/domain/authorization.ts`):

```ts
'tenant:create': ['owner', 'admin', 'visitor'],
```

Two properties of the model make that grant wider than the row alone suggests:

1. **Principal derivation is per-request and per-tenant-context.**
   `principalOf` reads the identity resolved for *this* request in *this* tenant
   context: an `owner`/`admin` staff grant, otherwise a `member` if a membership
   exists, otherwise `visitor`. `visitor` is therefore not a separate class of
   account — it is what **any authenticated identity** looks like when no tenant
   is resolved, which is exactly the base domain with no tenant selected.
2. **Creation is self-service and atomic.** `createTenant`
   (`core/server/usecases/create-tenant.ts`) runs the tenant-agnostic `authorize`
   (not `authorizeTenant`), validates slug and name, rejects a slug conflict, and
   then calls `tenants.createTenantWithOwner`, which writes the tenant row and
   the caller's owner grant together. The caller becomes the tenant's owner in
   one step; there is no operator approval anywhere in the path.

Composed, those two mean: **every authenticated account on the instance can
create a tenant and own it**, by addressing the base domain. For a
**public-SaaS instance** that is the intended product — sign up, create your
workspace, you are its owner.

It is the wrong default for a **single-creator instance**. One instance (one DB)
hosts many tenants over **one shared account pool** (§Authorization, "Tenant, not
instance"), and on a single-creator instance that pool is populated by the
creator's **end customers** — members. A member signing in at the base domain
resolves to no tenant, presents as a `visitor`, and holds `tenant:create`. The
model is behaving exactly as written; the grant row is simply a product decision
that the codebase currently hardcodes to one answer.

## Decision

1. **One env key, three modes: `TENANT_CREATION` ∈ `open | staff | closed`,
   default `open`.** The default preserves today's behaviour exactly, so no
   existing instance, seed, smoke or e2e drive changes; tightening the instance
   is an operator env change, not a code change.

2. **The `tenant:create` grant row becomes a function of the mode.** Nothing else
   in the policy moves:

   | mode              | `tenant:create` granted to | instance shape                                            |
   | ----------------- | -------------------------- | --------------------------------------------------------- |
   | `open` (default)  | `owner`, `admin`, `visitor` | public SaaS — any authenticated account self-serves a tenant |
   | `staff`           | `owner`, `admin`            | only existing staff spawn additional tenants; the first tenant comes from seed/operator |
   | `closed`          | — (nobody)                  | operator-only: tenants exist because seed/ops created them |

3. **The policy stays data.** `GRANTS` remains a
   `Record<Capability, readonly Principal[]>`, now *derived* from the mode rather
   than written as a literal — the mode selects one row's principal list. No
   branch is introduced into `decide`, and **default-deny is untouched**: a
   principal absent from a capability's list is denied, so `closed`'s empty list
   denies everyone (owners included) by the ordinary rule, not by a special case.

4. **No new principals and no new capability.** The four principals stay as they
   are; `tenant:create` stays one closed-union entry. The change is the *content*
   of one grant row, not the shape of the model.

5. **`staff` needs the create path to see staff-ness, which today it cannot.**
   The HTTP create route (`apps/server/src/app.ts`, `POST` on `API_PATHS.tenants`)
   deliberately sits **above** tenant resolution and constructs a
   `tenantlessIdentity(user)` with `staffRole: null` and `memberId: null` — so
   **every** authenticated caller reaches `createTenant` as a `visitor`,
   including owners and admins. Against that wiring the `staff` row
   (`['owner','admin']`) would deny everyone and be behaviourally
   indistinguishable from `closed`. Making the mode mean what it says therefore
   requires the create path to derive the principal from the caller's staff
   grants **across the instance**, not from a resolved tenant; the read already
   exists (`TenantAccessReader.listTenantsForStaff`, the same one `listMyTenants`
   uses). This is named here as a required part of the implementation, not left
   to be discovered: the grant table alone does not deliver `staff`.

6. **Rejected: a platform super-admin role (option c).** The obvious alternative
   to "operator-only via ops" is an in-app instance-level administrator who may
   create tenants under every mode. It is a strictly heavier tier — a fifth
   principal, an instance-scoped grant that lives outside tenant scope, its own
   storage, its own enforcement path and its own escalation risk — and there is
   **no named trigger** asking for it: operator-only creation is already reachable
   through seed/ops, which is where a single-creator instance provisions from
   anyway. It is revisitable the moment a real requirement names it.

## Consequences

- **A new key in the single env schema** (`core/server/config.ts`, DECIDE F4) and
  a matching entry in `.env.example`. Doc-lint enforces *schema ⊆ .env.example*,
  so the key cannot ship undocumented.
- **The capability table in [architecture.md §Authorization](../architecture.md#authorization)
  documents the mode-dependence**: the `tenant:create` row's cells are
  mode-derived, not fixed, and the surrounding prose names the env key. The
  website authorization page follows in the same PR.
- **Denial under `staff`/`closed` surfaces as the existing `forbidden` error** —
  `decide` returns its verdict, `authorize` maps it to `forbidden` (exit 4), the
  create route answers as it already does for any denied capability. **No new
  error codes, no new status, no new client branch**; a mode is invisible to the
  contract.
- **The exhaustive `decide` cell suite** (`core/domain/authorization.test.ts`
  asserts every capability × principal cell) now has one row whose expectations
  are per-mode, so `tenant:create` must be asserted across all three modes rather
  than once.
- **Bootstrapping is an accepted cost of the tighter modes.** Under `staff` the
  first tenant cannot be created in-app — no staff exists until a tenant does —
  so it comes from seed/operator; under `closed` every tenant does. That is the
  point of those modes, not a gap in them.
