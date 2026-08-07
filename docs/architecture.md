# Architecture

Normative reference for agentproofarch. The [PRD](prd-agentproofarch-foundation.md)
§3 is the original source; this document is its distilled, implementation-facing
form. The `demo/` folder implements it.

## Principles

- **Agent-first**: the primary feedback loop is the CLI — every API capability
  has a command with `--json` (one JSON envelope on stdout) and an exit code
  mapped from the error taxonomy. An agent can implement, run and verify
  features without a browser.
- **Pure core, thin edges**: business logic lives in framework-free TypeScript;
  HTTP servers, databases, auth providers and platforms are replaceable
  adapters behind ports.
- **Machine-enforced boundaries**: layer rules are lint rules
  (eslint-plugin-boundaries + dependency-cruiser), not conventions. `npm run
  check` is the static gate; `npm run smoke` is the runtime gate — it verifies
  the installed dependency tree matches the lockfile, boots the real server
  against a real database and drives health → sign-in → todos through the
  CLI, asserting taxonomy exit codes. Static-green is not done; the app must
  actually run.
- **Two first-class deploy targets** from the same commit: Vercel (serverless +
  Neon) and Docker self-host (Node + Postgres + Caddy). Platform names may
  appear only in `adapters/` and platform entry files.

## Layers

```
core/domain     entities, Result, error taxonomy, zod schemas   → zod only
core/contract   API routes + I/O schemas + error envelope       → domain
core/server     use-cases + ports (interfaces)                  → domain
core/client     typed HTTP client + query definitions           → contract
adapters/*      implement ports (db, auth, domain provisioning) → core
apps/server     HTTP wiring + composition root                  → everything server-side
apps/web        SPA (no SSR)                                    → core/client (+ auth client adapter)
apps/cli        commands                                        → core/client
```

Dependency rules (enforced):

- `core/**` never imports frameworks, servers or drivers (react, hono,
  drizzle, better-auth, pg, commander).
- `core/contract` is the only bridge between server and clients; clients never
  import `core/server` or `adapters/db`.
- Adapters are instantiated exclusively in the composition root
  (`apps/server/src/composition.ts`), where env decides implementations
  (`DB_DRIVER`, `DOMAIN_PROVISIONER`).
- `@vercel/*` and `@neondatabase/*` are importable only inside `adapters/`
  (and `entry.vercel.ts`).
- No `any`, no `as` (except `as const`), zod-parse at every boundary.

Dependency-free is not the goal; replaceability is. Core bans *infrastructure*
(frameworks, servers, drivers — anything with a plausible second implementation
or platform difference), which lives behind ports. *Vocabulary* libraries
(zod, `@tanstack/query-core`) are ordinary imports on the per-layer allowlist
above — they are practically language extensions, and swapping one would be a
rewrite regardless of any abstraction. Never wrap a vocabulary library in a
port — an interface with exactly one implementation forever is **port
theater**: it re-states the library's API without buying replaceability (a
`QueryPort` over TanStack Query would re-type `status`/`fetchStatus`,
invalidation and optimistic-update semantics, and still not survive an engine
swap). Extend the allowlist deliberately instead.

For genuinely complex clients (realtime push sync, event sourcing, heavy
concurrency) a richer vocabulary such as Effect is a legitimate choice in this
same slot — t3code builds its entire framework-free client core on it. It is a
foundation decision, never an incremental one: it replaces zod + query-core
wholesale, brings its own idiom, and needs its own guardrails (t3code vendors
the Effect sources with `LLMS.md` for agents and gates PRs with an AI reviewer
for idiomatic usage). Default remains zod + `@tanstack/query-core`.

## Frontend (apps/web)

The SPA is a thin client: domain logic lives in `core`, the web app renders
server state and collects input. Inner structure is enforced the same way as
the layers — boundaries + lint, not convention (see
[frontend-lint-plan.md](frontend-lint-plan.md); rationale in
[frontend-comparison.md](frontend-comparison.md)).

```
apps/web/src/
  main.tsx          composition root: providers + router wiring only
  api.ts            binds core/client action factories once — the only module
                    that sees ApiClient, AuthClientPort and adapters
  routes/           route components — thin: parse params, render a feature
  features/<name>/  feature folders: components, hooks, <Name>.logic.ts co-located
  components/ui/    design-system primitives → theme, lib only (no core, no features)
  lib/              pure TS utilities → no react
  theme.ts          the entire visual language (MUI theme); no colors/fonts elsewhere
```

State rules:

- **Server state**: TanStack Query only, consuming **bound actions** —
  `core/client` exports query/mutation factories (including auth actions over
  `AuthClientPort`), `api.ts` binds them once, and features import ready
  actions. Feature code never holds `ApiClient`, a port or an adapter, never
  defines `queryKey`/`queryFn` inline and never touches `fetch` (all lint).
  The descriptor object is the seam — TanStack is a vocabulary dependency,
  never wrapped in a port; full usage policy in
  [server-state.md](server-state.md).
- **Client state**: `useState`/`useReducer` local to the feature; React context
  only for cross-cutting concerns (theme, session). No global state libraries
  (lint).
- **URL state**: path params = resource identity, search params = shareable
  filters; neither is duplicated into component state.
- **Features are islands** (lint): a feature imports only itself. Features
  coordinate through server state (a command invalidates a scope, other
  features' queries refetch — the cache is the pub/sub, local and instant),
  through the URL, or through a route-level parent — never by importing each
  other or sharing client state. Shared code extracts downward
  (`components/ui`, `lib`, `core/client`), never sideways.
- **No client event bus.** A stringly-typed bus hides coupling from the
  dependency graph — the enforcers stop telling the truth and agents cannot
  trace control flow. If a genuinely ephemeral cross-feature signal ever
  recurs, the sanctioned shape is a closed union of typed events in one
  module (like `ErrorCode`) that both sides import — added at first proven
  need, never preemptively. Two features that constantly coordinate are one
  feature.

The action set is CQRS-partitioned: every action is either a query (safe
read) or a command (unsafe write) — no hybrids, enforced by read/write tags
flowing from contract route methods through the client types. All client
interfaces (web, CLI, future) consume the same partition.

App-level policies (the foundation prescribes the mechanism, each product
sets the numbers): **bundle budgets** — a size gate in `check` with
route-level splitting already mandated; thresholds are per app, none imposed
here. **Browser matrix** — default is evergreen-latest only (browserslist
`last 2 versions, not dead`); widening support is a per-app decision with its
own cost.

Mutations invalidate hierarchical query keys; manual cache writes only for a
single resource with rollback. Errors surface as `ApiError` carrying the
`AppError` taxonomy — rendered, never re-mapped ad hoc; a root error boundary
is mandatory. Non-trivial behavior is extracted to `*.logic.ts` and unit-tested
without rendering; component tests use real providers + MSW, never hook mocks.
React correctness (`react-hooks`, compiler, a11y, query plugins) runs at error
level in the same `npm run check` gate.

## Errors

Use-cases return `Result<T, AppError>`; nothing throws across a boundary.
`ErrorCode` is a closed union; the contract maps it exhaustively to HTTP
statuses and the CLI maps it to exit codes (`validation`=2, `unauthorized`=3,
`forbidden`=4, `not_found`=5, `conflict`=6, `tenant_not_found`=7,
`internal`=10). HTTP envelope: `{ ok: true, data } | { ok: false, error }`.

## API versioning and contract evolution

Server, web and CLI ship **together from one commit**
([ADR-0003](decisions/0003-vercel-environments.md)): the `core/contract` zod
schemas compile into all three, so client and server are never independently
versioned. `/v1`-style URL versioning solves skew between separately-released
client and server — a split this architecture does not have. **No version
namespace, no version header, no content negotiation.** The contract's types are
the version, checked at build for every consumer at once; a breaking change that
reaches production un-migrated is a red `check`, not a runtime surprise.

**NORMATIVE NOW** (every change to `core/contract`):

- **Additive-first.** New request fields are optional with a server default; new
  response fields are pure additions. A field's name, type and meaning are
  immutable once shipped — the old bundle still reads it under the old contract.
- **Rename / remove / retype = breaking = expand → contract, two deploys** — the
  same discipline ADR-0003 mandates for destructive migrations, one vocabulary
  for both. Deploy 1 adds the new shape alongside the old (both accepted and
  emitted); deploy 2 deletes the old once every consumer uses the new shape and
  the old-bundle window has drained.
- **Widening an enum is breaking for readers.** A new `ErrorCode` or status value
  the old bundle's exhaustive `switch` cannot handle is an expand step: teach
  clients the value (deploy 1) before the server emits it (deploy 2).
- zod-parse at every boundary (already normative under §Layers) is what makes a
  contract violation fail loud instead of corrupting state.

**The one real skew — the stale tab.** A tab left open overnight runs yesterday's
bundle against today's API (CLI and server are always the same commit; only a
long-lived SPA session drifts). `core/client` zod-parses every response and
returns `internal("… does not match the contract")` on a shape it doesn't
recognize, rendered by the root error boundary with the request's trace id — the
same failure the 2026-07-12 stale-`dist/web` incident exercised.
**Fail-loud-and-refresh is the accepted foundation UX**: an error card beats a
wrong render or silent data loss, and expand→contract keeps the window narrow
(only deploy 2 can briefly strand a tab). A "reload for the latest version" hint
is a recommended affordance, not a required mechanism; no push-based version
check is prescribed (the Vercel target has no resident channel).

**NORMATIVE WHEN TRIGGERED:**

| Trigger | Rule |
|---|---|
| First **external consumer** not built from this commit (public API, third-party integrator, separately-released mobile app) | Introduce explicit versioning — the compiled-contract argument no longer holds. Cheapest first: additive-only with a dated capability field; then a `/v1` URL prefix per major; then per-request `Accept-Version`. Internal `X-Tenant` clients do not count. |
| First **webhook we emit** to creators/integrators | Version the **payload**, not the URL: embed a `schemaVersion` in the event body, keep old fields additively, let subscribers pin. Delivery/idempotency reuse the inbound-webhook pattern (§Background jobs and webhooks) — this covers only the payload contract. |

**OUT OF SCOPE:** per-tenant/per-product API variants, GraphQL-style field-level
deprecation tooling, and consumer-driven contract testing against external
partners — all arrive with the external consumer that triggers real versioning.

## Identity and multi-tenancy

Authentication is separated from relationship
([ADR-0002](decisions/0002-member-identity-and-idp.md)): one global account
per email holds *authentication only* (passwordless + magic link allowed)
behind a narrow, OIDC-shaped `AuthPort` — the provider (Better Auth default)
is swappable by design, and its topology (embedded / separate container /
SaaS) is a composition-root choice. Two populations on top of it:

- **Tenant staff** — our `tenant_admins` aggregate: flat `owner | admin`
  grants, deliberately no teams/organizations concept (multiple admins are
  just multiple rows).
- **End customers ("members")** — our own tenant-scoped aggregate (profile,
  tags, GDPR consents, owned email snapshot, export).

Product-required auth methods — magic link, social login, passkeys, 2FA —
are provider features exposed only through `AuthClientPort` and required
from the proof of concept onwards. `userId` is an opaque string: foundation
tables never FK provider tables.

No auth-provider organization/team feature is used for either population —
the provider supplies identity only (`userId`, email, name, verification
status) and `tenants` is a foundation entity, never a provider object.
Provider org APIs let users list their organizations (would leak a
customer's other tenants), provider-attached relationship data would turn an
IdP swap into a data migration, and tenant creation must not depend on the
auth provider.

Tenant resolution per request: custom domain (from `tenant_domains`) →
subdomain of `APP_BASE_DOMAIN` (slug) → `X-Tenant` header (CLI); membership is
always verified. Every tenant-scoped use-case takes `ctx: { identity }` first
and every tenant-scoped repository call requires `tenantId`. Sessions span
`APP_BASE_DOMAIN` subdomains; each custom domain is its own cookie world
(sign-in per domain — deliberate isolation).

**Tenant, not instance**: one instance (one DB) hosts many tenants over one
shared account pool — a creator's unrelated brands should be tenants, not new
deployments. Cross-instance/cross-app SSO is an evolution path (central OIDC
IdP via an `AuthPort` adapter swap), not a foundation feature.

## Data lifecycle

How tenant data is deleted, exported and retained. Complements the two-operation
deletion model in [ADR-0002](decisions/0002-member-identity-and-idp.md) (creator
removes a member vs a user erases their global account) with the storage-level
rules, and states what is enforceable versus convention.

**Hard delete is the default** (NORMATIVE NOW). A tenant-scoped delete removes the
row. "Soft-delete everything" is a lie the moment one query forgets the
`deleted_at IS NULL` filter — a leaked row reads as live data, and that filter
lives in every query, not the schema. `deleted_at` (nullable) is reserved for
aggregates with a product requirement for undo/trash (restore a deleted course),
added per-feature, never blanket; where used, **every repository query for that
aggregate must filter `deleted_at IS NULL`** and expose recovery explicitly —
convention enforced by review + the aggregate's repo tests, not by type or lint,
so the honest posture is to keep the soft-deleting surface tiny. A partial unique
index (`WHERE deleted_at IS NULL`) is mandatory wherever a soft-deleted row must
not block re-creating the same natural key.

**Tenant offboarding is a schema invariant** (NORMATIVE NOW). Every tenant-scoped
table FK-chains to `tenants(id)` with `ON DELETE CASCADE`, directly or
transitively: "delete everything for tenant X" is one
`DELETE FROM tenants WHERE id = $1`, with the database — not application code —
guaranteeing no orphans. Global/shared tables (accounts, the shared account pool)
are deliberately outside that chain: one account spans many tenants (§Identity and
multi-tenancy), so it must never cascade from a single tenant's deletion. The
invariant is mechanically checkable — a smoke/integration test seeds every
aggregate for a throwaway tenant, deletes the tenant row, and asserts zero rows
remain for that `tenantId` (pattern normative, demo implements on first need).

**GDPR mechanics** (NORMATIVE WHEN TRIGGERED — trigger: first real end-user
personal data in production, beyond the demo seed). Right to access/portability is
an `exportTenantData` use-case in `core/server` that walks the tenant's aggregates
into one JSON envelope, exposed as a `--json` CLI command and a web action —
generalising the member-level export ADR-0002 already requires. Right to erasure
is the tenant cascade above plus account anonymisation: erasing a global account
removes credentials at the provider (foundation tables never FK provider tables),
and any owned-email snapshot held in member rows is tombstoned in place, not left
as PII. Until the trigger fires this is a documented use-case shape, not shipped
code — the demo carries no real personal data.

**Retention** (NORMATIVE NOW) is a sink setting, not code: the application stores
no logs or traces itself and configures no app-side retention — telemetry leaves
via OTel exporters (§Observability, [observability.md](observability.md)), so
retention is Sentry's per-project window or the columnar tier's window, named
there, nothing to enforce in the repo. Operational data (jobs/outbox,
processed-events) gets a per-table prune job only when volume demands it
(§Background jobs and webhooks).

**Backups** (NORMATIVE NOW): on Vercel/Neon, disaster recovery is Neon instant
restore (branch-from-timestamp, the same mechanism as preview branching); the Free
tier's **6-hour** restore window is adequate for the demo but explicitly
insufficient for production personal data — a longer window (Launch ≈ 1 day, Scale
up to 30 days) is a paid-plan flip made when the GDPR trigger fires. Self-host
owns its own cadence; the foundation prescribes the mechanism (Postgres base
backups / `pg_dump`), not a schedule.

**OUT OF SCOPE** — audit trail (trigger: a specific compliance or contractual
requirement). There is no append-only audit log at the foundation level. Wide
events are observability, not audit: they are sampled, retained by a short sink
window, and shaped for debugging; an audit trail is durable, complete,
tamper-evident and answers "who changed what, when" on demand. When a real audit
need appears it is a new aggregate with its own retention, not a telemetry
setting.

## Public surface

Products on this foundation ship no public marketing pages — creators bring
their own sites ([ADR-0001](decisions/0001-public-surface-embeds-over-pages.md)).
The platform owns the commerce layer and exposes it as: public read-only
contract routes (unauthenticated GET, open CORS, cache keyed to tenant content
version), shareable flow URLs on tenant domains (checkout without any
creator-hosted page), post-MVP iframe embed widgets (`/embed/*`, Hono +
`hono/jsx` typed templates — plain HTML, no client runtime), and a recommended
(pending confirmation) headless React SDK reusing `core/contract` types. The
authenticated app remains a static SPA.

## HTTP caching

Cache policy is set at one seam — `respond()` in `apps/server/src/app.ts`, where
every success and error envelope is built — so the default is impossible to
forget and any opt-in is a visible, local exception.

**NORMATIVE NOW** (every app on the foundation):

- **Authenticated, tenant-scoped JSON is `Cache-Control: no-store`.** `respond()`
  sets it on every envelope; a route becomes cacheable only by explicitly
  overriding on its 2xx path. `private, max-age=N` is wrong here: `private` only
  bars *shared* caches, so the browser (or a tenant-oblivious intermediary) still
  stores a body that one origin serves for many tenants — a cross-tenant leak the
  moment identity resolves differently on the same connection. Errors flow through
  the same `respond()` and inherit `no-store`, so a transient failure can never be
  pinned at the edge. The rule lives at that one seam and is pinned by a `smoke`
  assertion on a live API response.
- **Static SPA assets — two rules.** Vite content-hashes bundles, so
  `/assets/(.*)` gets `Cache-Control: public, max-age=31536000, immutable` (via the
  `vercel.json` headers block) while `index.html` keeps the platform's
  revalidate-always default so a new deploy is picked up immediately. Self-host
  parity: the Node `serveStatic` (or Caddy) sets the same two headers, so both
  targets behave identically from one commit.
- **No `ETag`/`Last-Modified`/304 on the JSON API.** HTTP revalidation would
  duplicate the only client read cache — TanStack Query, governed by
  `staleTime`/`gcTime` (see [server-state.md](server-state.md)) — so the two
  layers never cache the same bytes and there is nothing to invalidate twice.

**NORMATIVE WHEN TRIGGERED** — trigger: the first unauthenticated `GET` in the
public contract group (offers/prices, §Public surface). Until one exists the
`no-store` default is the whole policy. Public routes then opt in through one
shared helper emitting
`Cache-Control: public, max-age=0, s-maxage=<n>, stale-while-revalidate=<n>` (the
browser always revalidates, Vercel's Edge Network caches for `s-maxage` and serves
stale-while-revalidate) — no hand-written `Cache-Control` strings at call sites.
Busting is by **content-version in the URL/key**, not an edge purge: a content
change is a new key, which is exactly the "cache keyed to tenant content version"
that §Public surface and
[ADR-0001](decisions/0001-public-surface-embeds-over-pages.md) already name. Open
`GET` CORS is set on this group only, never on the authenticated `/api/*` surface.

**OUT OF SCOPE:** per-user `private` response caching (`no-store` is the
authenticated default), service-worker/offline HTTP-cache persistence (a product
feature, mirroring server-state.md's cache-persistence stance), platform image
optimisation (assets ship pre-hashed from Vite), and edge purge / on-demand
revalidation (public caching busts by content-version key).

## Ports (complete list)

- `AuthPort` (server): request headers → authenticated user. Better Auth.
- `AuthClientPort` (client): sign-up/in/out + magic link. Better Auth client.
- `DomainPort`: add/check/remove tenant domains. Implementations: Vercel
  Domains API, Caddy on-demand TLS, noop (dev).
- Repository interfaces per aggregate (todos, tenant domains, memberships).

Add a port only when a second implementation or a platform difference actually
exists.

## Storage and email ports (deferred)

Two capabilities every product eventually needs — persisting binary objects and
sending mail — that no current use-case requires. The foundation fixes the port
shape, the per-target adapters and the tenant-scoping rules; the demo adds each
port only when a feature pulls its trigger (the JobsPort precedent: pattern
normative, demo implements on first need). Both live in `core/server`, are
instantiated only in the composition root, and are called only from use-cases —
never from routes, never from adapters. Ports return plain `Promise`; the
use-case wraps the result in `Result<T, AppError>`, matching the existing
repository ports.

**StoragePort** — binary object persistence.

- Shape: `put(tenantId, path, body, opts)`, `getSignedUrl(tenantId, path, opts)`,
  `remove(tenantId, path)` — `tenantId` first, like every repository method.
- **Tenant scoping is the port's job** (NORMATIVE): the caller passes a logical
  `path` (`avatars/<id>.png`); the adapter composes the real key as
  `tenants/<tenantId>/<path>` and rejects any `path` that escapes the prefix
  (`..`, leading `/`, absolute keys). The key space is closed by construction, so
  one tenant can never address another's objects.
- **Reads go through short-lived signed URLs** (NORMATIVE): objects are private,
  the client never receives a bucket credential or a permanent public URL; public
  assets, if ever needed, are an explicit separate method.
- Adapters follow the Vercel-default / Docker-escape-hatch split (`STORAGE_DRIVER`
  selects, like `DB_DRIVER`): Vercel Blob on Vercel; any S3-compatible endpoint
  (MinIO, Neon Object Storage, R2, B2) on self-host; a filesystem adapter in dev
  and an in-memory fake asserting the tenant-prefixed key in tests. `@vercel/blob`
  stays inside `adapters/` under the existing `@vercel/*` boundary rule.
- **Trigger** (WHEN TRIGGERED): the first feature persisting a caller-supplied
  binary — avatar, product/download asset, or a GDPR-export file that outlives one
  request. In-request bytes streamed straight to a response do not trigger it.

**EmailPort** — transactional mail.

- Shape: `send({ to, subject, html, text })`. No `tenantId`: the foundation sends
  from one verified domain; per-tenant branded senders are a when-triggered
  extension.
- **Sent only from use-cases** (NORMATIVE, convention + review — no lint rule): a
  route parses input and invokes a use-case; the use-case decides to mail, keeping
  send decisions inside the `Result` discipline.
- **Reliability via the outbox, not inline retries** (NORMATIVE once the outbox
  exists): when `JobsPort` lands (§Background jobs and webhooks) a use-case
  enqueues the send transactionally with its domain write. Until then a use-case
  may call `EmailPort.send` directly, but the handler must be safe to re-run — the
  same idempotency contract as the webhook inbox.
- Adapters: Resend on both targets (HTTP delivery suits serverless and self-host
  equally; AWS SES is the named volume escape-hatch via `EMAIL_DRIVER`); a
  `console` adapter in dev (magic links stay copy-pasteable) and a capturing
  adapter in tests.
- **Trigger** (WHEN TRIGGERED): the first **non-auth** transactional email from a
  use-case (order receipt, member invite, export-ready notice). Better Auth's own
  magic-link/verification mail is the auth adapter's concern, wired in
  `create-auth.ts` (console in dev, Resend in prod), and does not by itself
  introduce `EmailPort`; when `EmailPort` lands, the auth adapter's sender should
  delegate to it so there is one transport and one from-address policy.

**OUT OF SCOPE:** email content/templates, sequences, marketing sends, per-tenant
sender identity, image processing/thumbnailing, virus scanning, CDN cache policy —
all app-domain, decided per product.

## Deployment matrix

| | Vercel | Docker self-host |
|---|---|---|
| API | Hono handler as a function | same Hono app in a Node container |
| DB | Neon, `DB_DRIVER=neon-http` | `postgres:16`, `DB_DRIVER=node-postgres` |
| Web | static SPA build | served by the same Node process |
| TLS for tenant domains | Vercel Domains API | Caddy `on_demand_tls` + domain-check endpoint |

Vercel is the default because it is the simplest for most applications — the
same reasoning that makes TanStack Query the default over Effect. It is
invocation-only: no resident process, so no queue workers, schedulers,
websockets or long-running jobs. The Docker image is the full-runtime escape
hatch from the same commit and runs anywhere (VPS, Railway, Fly.io,
Kubernetes); anything that needs a resident process lives on that target.

## Environments (Vercel target)

Four environments, mapped onto Vercel's native model
([ADR-0003](decisions/0003-vercel-environments.md)):

| Env | Git | Database | Host |
|---|---|---|---|
| Production | `main` | Neon branch `production` | project domain (custom + wildcard when added) |
| Staging | branch `staging` | Neon branch `staging` | staging branch alias URL |
| Preview | every PR | **ephemeral Neon branch per PR** (marketplace integration) | per-PR URL |
| Development | local | Docker Postgres (or a Neon `dev` branch) | `*.localhost` |

Rules:

- **Secrets live only in Vercel's env store**, scoped per environment (staging
  = branch-scoped Preview vars on Hobby); local dev pulls them with
  `vercel env pull`. Nothing secret in the repo — `.env.example` documents
  names only.
- **Migrations run at build time** against that environment's own database
  (previews migrate their ephemeral branch — always safe; staging/prod are
  forward-only: destructive changes ship as two deploys, expand → contract).
- **Promotion is the PR flow**: feature branch → preview → `staging` →
  `main`. Same commit, only env vars differ.
- **Tenant subdomains need the custom wildcard domain**; until one is
  attached, web runs single-tenant on `*.vercel.app` while the API and CLI
  stay fully multi-tenant via `X-Tenant` — which is also how `smoke` drives a
  deployed environment (`npm run smoke:remote` = the same CLI suite against a
  deployment URL).

## Security baseline

The threat model is a multi-tenant SPA and API on one origin behind Better Auth.
The two invariants that actually hold the system together are already enforced
(§Layers, §Identity and multi-tenancy): auth runs *before* tenant resolution, and
every tenant-scoped repository method takes `tenantId`, so the type system will
not let a query span tenants — this is the primary access control, everything
below is defense-in-depth around it. Everything under NORMATIVE NOW is wired in
the demo (`app.ts` `secureHeaders`/`bodyLimit`, `create-auth.ts` rate limiting,
`vercel.json` headers) and asserted by the smoke gate.

**NORMATIVE NOW:**

- **Security headers** via Hono's built-in `secureHeaders`, mounted first in
  `app.ts` (one origin → one policy covers SPA and API): `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP of
  `script-src 'self'` (Vite bundles all JS — no inline/eval; this is the directive
  that stops XSS), `style-src 'self' 'unsafe-inline'` (emotion injects runtime
  `<style>` tags; `'unsafe-inline'` for styles only is not a script vector and a
  nonce would fight emotion's cache), `connect-src 'self'`, `img-src 'self' data:`,
  `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. A fresh app
  on the foundation enforces from day one (the smoke gate exercises it before
  merge); when retrofitting an existing app, ship report-only for one deploy,
  then enforce. The `smoke` suite asserts the headers on a live response — the
  mechanical hook that keeps this from being convention-only. On Vercel the
  static SPA bypasses the function, so `vercel.json` carries the same headers
  for non-`/api/` paths; the Hono middleware covers the API and self-host.
- **Cookie/session hardening.** Better Auth sets `HttpOnly`, `SameSite=Lax` and
  signs the session cookie by default; we own two knobs, already wired in
  `create-auth.ts`: `SECURE_COOKIES=true` is required in staging/prod (drives the
  `Secure` flag; defaults false only because `*.localhost` is plaintext), and
  `crossSubDomainCookies` is on for a real `APP_BASE_DOMAIN` (sessions span tenant
  subdomains) and off for `localhost` (browsers reject `Domain=.localhost`).
- **Auth rate limiting.** Better Auth's built-in limiter guards **only
  `/api/auth/*`**; its default in-memory storage is useless on Vercel (every
  invocation is a fresh isolate), so set `storage: "database"` to keep counters in
  the Neon we already have — $0, no Redis — and enable it explicitly (off in dev by
  default). It does not protect mutation routes, which is why those stay gated by
  auth + tenant scope.
- **Request body limits.** Mount Hono's `bodyLimit` on mutation routes (JSON
  payloads are small — a ~64–100KB cap is a cheap DoS floor); Vercel's 4.5MB
  serverless cap is a backstop, not policy.
- **Secrets.** Secrets live only in Vercel's env store (§Environments), parsed
  through `env.ts` so the process refuses to boot on invalid config. **Never a
  `VITE_`-prefixed secret** — Vite inlines `VITE_*` into the client bundle, so the
  prefix means public (today's only one, `VITE_SENTRY_DSN`, is a public DSN).
  `BETTER_AUTH_SECRET` is server-only and its `dev-only-secret…` default must be
  overridden with strong entropy outside local.
- **Dependency hygiene.** `package-lock.json` is committed and validated by
  lock-lint in `check`. `npm audit --omit=dev --audit-level=high` runs in CI as an
  **advisory** (reported, non-blocking — audit's false-positive rate makes a hard
  gate a build-breaker on transitive noise); a high/critical advisory is triaged,
  and version bumps come through Dependabot/Renovate PRs that pass both gates.
- **Trace-id exposure is safe.** The W3C trace id in the error fallback is a random
  correlation id — no PII, no capability, actionable only to someone who already
  has backend log access — so surfacing it turns a support ticket into a one-line
  log lookup at zero disclosure cost.

**NORMATIVE WHEN TRIGGERED:**

- **Mutation-endpoint rate limiting** — trigger: the first *unauthenticated*
  mutation or public write (checkout, sign-up abuse). Authenticated mutations are
  already gated by auth + tenant scope; a per-user/per-tenant limiter (a DB-backed
  counter, or the Upstash Redis already in play for QStash) is chosen then, not
  pre-built.
- **CSP relaxation for Sentry** — trigger: `VITE_SENTRY_DSN` set in an
  environment; add that ingest host to `connect-src` for that environment only.
- **`frame-ancestors` split for embeds** — trigger: the post-MVP `/embed/*`
  widgets (§Public surface), which are designed to be framed on creator sites.
  Those routes get their own permissive `frame-ancestors` via a route-scoped
  `secureHeaders`; the authenticated app keeps `'none'`.
- **Upload size + type limits** — trigger: the first file-upload feature; a
  dedicated bounded `bodyLimit` + content-type allowlist on that route, streamed to
  object storage (§Storage and email ports), never buffered through the API.

**OUT OF SCOPE:** WAF / bot-management / DDoS scrubbing (Vercel's edge covers
L3/4), field-level encryption and PII-retention policy (product data model), GDPR
export/erasure *mechanics* (§Data lifecycle), and pentest / SOC2 process.

## Background jobs and webhooks

Webhooks are plain HTTP and fit both targets as-is. For Stripe, the provider's
own delivery model is the reliability backbone (verified 2026-07, see
[jobs-research.md](jobs-research.md)): signed events, retries with exponential
backoff for up to 3 days in live mode, duplicates/concurrent/out-of-order
delivery expected by contract. The handler pattern is therefore: verify
signature → insert into a processed-events table (unique on event id; dedupe
also on object id + event type) → do the work transactionally → 2xx only on
success, so a failure re-arms Stripe's retry. Fulfillment is webhook-driven,
never success-page-driven (Stripe mandates this). At low volume this
synchronous pattern needs **no queue at all**.

Deferred work (email sequences, aggregations) is a first-class module whose
invariants hold on both targets:

- **State**: a queue/outbox table in the Postgres we already have — enqueue is
  transactional with the domain write. No new stateful infrastructure.
- **API**: `JobsPort` (enqueue/schedule) in `core/server`; job handlers are
  ordinary core use-cases, tested like any other.
- **Executor** is the only per-target difference (same pattern as
  `DB_DRIVER`):

| | Vercel | Docker self-host |
|---|---|---|
| Executor | `/internal/jobs/drain` endpoint, batch per invocation | pg-boss resident worker — second compose service from the same image; `WORKER_MODE=inline` for minimal installs |
| Wake-up | Upstash QStash schedule (free: 1k msgs/day, HTTP push, 3-day DLQ) — Vercel Cron is too limited on free plans, Vercel Queues is metered-paid, Neon pg_cron cannot run under scale-to-zero | in-process |

`JobsPort` joins the ports list when the first real deferred job lands (port
rule: no port before a second implementation or platform difference exists —
here the platform difference is proven, the need is not yet).

A/B conversion attribution needs no jobs infrastructure: assignment cookie →
variant id in Checkout `metadata`/`client_reference_id` → webhook records the
conversion idempotently → aggregation is a read query (or a scheduled job
later).

## Observability

OpenTelemetry is the instrumentation standard (`@opentelemetry/api` is a
no-op facade — vocabulary, not infrastructure; SDK and exporters wire in the
composition root). The practice is **wide events**: one context-rich event per
request per service hop — annotate the active span as context accrues, emit
once; never step-log. One W3C trace id spans SPA → API → DB (injected in
`core/client`'s `request()`, continued by Hono middleware) and is shown in the
error fallback for support. Sentry is the default sink (errors + traces);
columnar stores (Axiom / self-hosted ClickHouse) are the named upgrade for
event analytics. Tail sampling controls cost: keep all errors and slow
requests, sample the happy path. Full policy:
[observability.md](observability.md).

## Foundation evolution (consuming the foundation)

How a real product is born from this repo and stays *on* the foundation. `demo/`
is the reference implementation; a product is a copy of it that grows its own
domain. The **enforcement configuration — not the code — is the portable
artifact** that keeps the copy "agentproofarch".

**Consumption model** (NORMATIVE NOW): copy `demo/` (its git history is not
inherited) and write a `FOUNDATION.md` at the app root recording the upstream repo
URL, the forked commit SHA, the fork date and the foundation-owned paths below.
Provenance is one cheap file; a foundation update is then a mechanical
`git diff <sha>..upstream` over those paths, never a guess. A long-lived fork with
upstream merges (app history couples to foundation history; every merge conflicts
in app-owned `features/`) and an npm-published `core` (fights *app owns its core* —
core holds the app's domain and must be edited and linted as source, not pinned as
an opaque dep) were both considered and rejected.

**The portable artifact travels unchanged** because it encodes the architecture
structurally rather than describing it: `eslint.config.js` +
`eslint-plugin-agentproofarch/` (the `query-descriptors-only` and `sx-layout-only`
rules) + `.dependency-cruiser.cjs` (`no-frameworks-in-core`,
`core-domain-depends-on-nothing`, `vercel-and-neon-only-in-adapters`,
`web-features-are-islands`) for the layer and frontend graph; and `tsconfig.json`
strictness, `scripts/doc-lint.ts`, `scripts/smoke*.ts`, the
`check`/`smoke`/`lock-lint` scripts, `config-regression/` and the CI workflow for
the gates.

- **MAY change freely** (NORMATIVE NOW): everything domain- and product-specific —
  `features/`, aggregates beyond the walking skeleton, adapter choice, `theme.ts`,
  routes, CLI commands, per-app thresholds the foundation leaves open (bundle
  budgets, browser matrix) and the app's own ADRs. These diverge immediately and
  are never diffed against upstream.
- **SHOULD keep in sync** (NORMATIVE NOW): the portable-artifact paths above — on a
  foundation update, apply the recorded-SHA diff over exactly those paths; a
  security or CI fix is a config-diff, not a rewrite.
- **OFF the foundation** (NORMATIVE NOW): weakening the *structural* rules, not the
  numbers. Letting a client import `core/server`, a framework into `core/**`,
  dissolving the `core/contract` seam, throwing across a boundary (dropping
  `Result<T, AppError>`), or re-enabling `any`/`as` makes you a fork with a
  different architecture — a legitimate choice that forfeits the name and the
  guarantee. Doc-lint keeps this honest either way: removing an enforcer from
  config without updating the docs that promise it fails the gate
  ([ADR-0004](decisions/0004-no-exceptions-enforcement.md)), so divergence cannot
  be silent.
- **Docs** (NORMATIVE NOW): foundation docs (`architecture.md`, the ADRs) are
  copied read-mostly and edited only to *record* a deliberate divergence (doc-lint
  forces this when a config changes); app-specific docs and ADRs live in the app's
  own tree and numbering, never by mutating foundation docs in place.
- **`demo/` stays exemplary** (NORMATIVE NOW): it is the fixture the gates run
  against and the thing every product forks from, so it carries only the walking
  skeleton (auth, tenants, one resource end-to-end) — a change that would not
  generalise to every app on the foundation does not belong in it.

**Extract configs to a package** (NORMATIVE WHEN TRIGGERED — a real second app
exists): the enforcement configs alone MAY graduate to a versioned package (they
are domain-free — a genuine library, unlike `core`), letting apps pull rule updates
by version bump instead of by diff. This resolves the npm tension without violating
*app owns its core*. Until then, copy is simpler and $0.

**OUT OF SCOPE:** the product's domain model, business rules, and pricing/limit
numbers are the app's, never the foundation's.
