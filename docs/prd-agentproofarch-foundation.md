# PRD: Agentproofarch — Agent-First Full-Stack Foundation

## 1. Introduction / Overview

Agentproofarch is a foundation (starter architecture, not a product) for building multi-tenant SaaS web applications that are maximally friendly to AI-agent development. Every business feature built on top of it flows through strictly enforced layers: a pure-TypeScript core, thin adapters for external resources, and thin client/server applications. The primary feedback loop for agents is the CLI: every capability of the platform is invocable from the command line with structured JSON output and deterministic exit codes, so an agent can implement, run, and verify features without a browser.

The foundation itself contains **no example business resource** — its own features (auth, organizations, custom domains) are the walking skeleton that proves the architecture end-to-end. A separate example application will be built on top of it later.

Two deployment targets are first-class and must work from the same commit:
- **Vercel** (static SPA + serverless functions + Neon Postgres)
- **Docker self-host** (`docker compose up`: app container + Postgres + Caddy with automatic TLS)

## 2. Goals

- A repository where architectural rules are machine-enforced (ESLint boundaries + dependency-cruiser), so an AI agent physically cannot violate layering without failing `npm run check`.
- Full multi-tenant auth: registration, login, organizations, invitations, tenant switching. One email = one global account that can belong to many tenants.
- Custom domains per tenant working on both targets: Vercel Domains API and Caddy on-demand TLS.
- A CLI that covers 100% of the foundation's API surface with `--json` output and mapped exit codes — the reference client and the agent verification loop.
- A React SPA (no SSR) exercising the same typed core client as the CLI.
- Zero platform lock-in in core: the strings "vercel" and "neon" may appear only in `adapters/` and in `apps/server/src/entry.vercel.ts`, enforced by lint.
- Single repo, single `package.json`, no workspaces, no package publishing.

## 3. Architecture (normative)

This section is the contract every user story must respect.

### 3.1 Directory layout

```
core/
  domain/      # entities, value types, Result type, error taxonomy, zod schemas
               # dependencies: zod only
  contract/    # API contract: route definitions, request/response schemas,
               # error envelope. Single source of truth between client & server.
               # dependencies: core/domain, zod
  server/      # use-cases + ports (interfaces): AuthPort, DomainPort,
               # repository interfaces. Pure TS. No HTTP, no React, no Node
               # platform APIs beyond std types.
               # dependencies: core/domain
  client/      # typed HTTP client built from contract + query/mutation
               # definitions on @tanstack/query-core + AuthClientPort interface.
               # dependencies: core/contract, @tanstack/query-core
adapters/
  db/          # Drizzle schema, migrations, repository implementations,
               # driver factory (node-postgres | neon-http)
  auth/        # Better Auth server config (identity only — no org plugin)
               # implementing AuthPort; client adapter implementing AuthClientPort
  domain-provisioning/
               # DomainPort implementations: vercel.ts (Domains API),
               # caddy.ts (on-demand TLS check), noop.ts
apps/
  server/      # Hono app: routes wired from contract to use-cases, middleware,
               # composition root; entry.node.ts and entry.vercel.ts (~5 lines each)
  web/         # React SPA: Vite + TanStack Router + TanStack Query
  cli/         # commander-based CLI: thin mapping of core/client to commands
tasks/         # PRDs and agent task files
```

### 3.2 Dependency rules (lint-enforced, violations fail CI)

- `core/domain` → zod only.
- `core/contract` → `core/domain`.
- `core/server` → `core/domain`. Never imports contract, adapters, apps, hono, react.
- `core/client` → `core/contract`, `@tanstack/query-core`. Never imports core/server or adapters.
- `adapters/*` → `core/server` (to implement ports), `core/domain`.
- `apps/server` → everything server-side (composition root). The ONLY place adapters are instantiated.
- `apps/web`, `apps/cli` → `core/client` (+ `adapters/auth` client part via AuthClientPort wiring). Never import `core/server` or `adapters/db`.
- Imports of `@vercel/*` and `@neondatabase/*` are forbidden everywhere except `adapters/` and `apps/server/src/entry.vercel.ts`.
- No circular dependencies anywhere (dependency-cruiser).

### 3.3 Error taxonomy and result envelope

- Use-cases return `Result<T, AppError>` (discriminated union, no thrown exceptions across boundaries).
- `AppError = { code: ErrorCode; message: string; details?: unknown }` where `ErrorCode` is a closed string-literal union defined in `core/domain` (e.g. `"unauthorized" | "forbidden" | "not_found" | "validation" | "conflict" | "tenant_not_found" | "internal"`).
- HTTP envelope: success `{ ok: true, data: T }`, failure `{ ok: false, error: AppError }` with matching HTTP status. Defined once in `core/contract`.
- `core/client` deserializes the envelope back into `Result<T, AppError>` — clients never parse raw HTTP.
- CLI maps `ErrorCode` → exit code via a single exhaustive table (e.g. ok=0, validation=2, unauthorized=3, forbidden=4, not_found=5, conflict=6, internal=10).

### 3.4 Identity and tenancy model

Authentication and relationship data are strictly separated (see
[ADR-0002](decisions/0002-member-identity-and-idp.md)):

- **Global account = authentication only.** `users` (managed by the auth
  provider behind `AuthPort`): one email = one account, holding nothing but
  identity and credentials. Passwordless accounts are first-class: an account
  may be created without a password (e.g. provisioned after a purchase) and
  authenticated via magic link.
- **The provider supplies identity only.** No auth-provider organization /
  team features are used at all — every relationship (tenancy, staff,
  customers) lives in foundation tables. `tenants` is our own domain entity,
  never a provider object.
- **Tenant staff = flat admin grants, no teams.** `tenant_admins { tenantId,
  userId, role: owner | admin }` — an owner may grant the same flat admin
  access to additional users; there is no team/organization concept, no
  nested permissions. Staff invitation flows are post-MVP (PoC: owner adds
  an admin by email).
- **End customers ("members")** = our own tenant-scoped aggregate:
  `members { id, tenantId, userId, email, displayName, tags,
  marketingConsents, externalCustomerIds, createdAt }` plus any
  product-level data keyed by `memberId`. All relationship data (profile,
  tags, consents, progress) lives here — never on the global account. The
  member row owns its email snapshot: export and marketing never depend on a
  join to (or a live call against) the auth provider. Staleness after an
  account email change is handled by refresh, not by querying at read time:
  every authenticated request already carries the fresh email via `AuthPort`
  — when it differs, the member rows update; provider update webhooks can
  refresh members who never sign in again.
- **Provider identifiers are opaque.** `userId` is a string; foundation
  tables never declare foreign keys into provider-owned tables (with a SaaS
  provider those tables do not exist locally).
- **Identity shape** distinguishes the two populations:
  `Identity = { userId, email, name, tenantId: string | null,
  staffRole: 'owner' | 'admin' | null, memberId: string | null }`.
- Rationale for keeping ALL relationships out of the provider: privacy (a
  customer must not be able to enumerate the tenants they belong to —
  provider org APIs leak this by design), IdP swappability (no relationship
  data migrates when the auth provider changes — the swap touches sign-in
  only), semantics (customers buy access; they are not invited staff),
  scale, and decoupling (creating a tenant must not call the auth
  provider's API).
- **Deletion semantics** are two distinct operations: (1) a creator removes a
  member from THEIR tenant = delete the `members` row + tenant-scoped data;
  the global account survives (it may belong to other tenants). (2) The user
  erases their global account (GDPR request to the platform) = credentials
  and identity removed; tenant-scoped member data is each tenant controller's
  responsibility.
- **GDPR roles**: the creator is the data controller of their tenant's member
  data; the platform operator is the processor for tenant data and the
  controller of the minimal global account (email + credentials). Marketing
  consents exist only per tenant. Member export per tenant (CSV/JSON,
  including email from the member row) is a foundation capability.
- `tenant_domains` table (ours): `{ id, tenantId, domain, kind: "subdomain" | "custom", verified, createdAt }`.
- `AuthPort` yields the authenticated user; the tenant-resolution middleware in core builds `Identity` (shape above) per request.
- Every tenant-scoped use-case takes `ctx: { identity: Identity }` as its first parameter (lint/review rule) and every tenant-scoped repository method requires `tenantId`.
- Tenant resolution middleware, in order: (1) exact match in `tenant_domains` on `Host` (custom domain), (2) subdomain of `APP_BASE_DOMAIN`, (3) `X-Tenant` header carrying tenant slug (used by CLI hitting the base API domain). In all cases membership of the authenticated user is verified; failure → `tenant_not_found` / `forbidden`.
- **Sessions and domains**: one session spans all subdomains of
  `APP_BASE_DOMAIN`; a custom tenant domain is its own cookie world — members
  sign in per custom domain (magic link on the tenant's domain), which is a
  privacy feature, not a bug. `trustedOrigins` must be resolved dynamically
  against verified `tenant_domains`.
- **Tenant, not instance**: one instance (one deployment, one database) hosts
  many tenants and one shared pool of authentication accounts — so one
  customer account across a creator's unrelated brands/courses is free within
  an instance. A new instance (separate account pool) is justified only by
  hard isolation or compliance requirements. Cross-instance / cross-app SSO
  is the documented evolution path: promote the auth provider to a central
  OIDC identity provider and swap the `AuthPort` adapter; `members`
  aggregates are unaffected. Not built in the foundation.

### 3.5 Ports (complete list for the foundation)

- `AuthPort` (server): request → `Identity` or error. Implementation: Better Auth.
  The surface stays narrow and OIDC-shaped (who is this user, nothing more) so
  the provider is swappable (Better Auth ↔ Clerk/Auth0 ↔ a central OIDC
  instance) — this swappability is a requirement, not an accident. The IdP
  topology (embedded in-app / separate container / SaaS) is a composition-root
  decision, default embedded.
- `AuthClientPort` (client): `signUp/signIn/signOut/getSession` plus the product-required auth methods: magic link, social sign-in, passkeys, 2FA enrol/verify. Every method on the port must exist across candidate providers (Better Auth plugins, Clerk, Auth0) so the port never locks us in. Implementation: Better Auth client.
- `DomainPort`: `addDomain(domain)`, `removeDomain(domain)`, `checkDomain(domain)`. Implementations: `vercel` (Domains API), `caddy` (no-op provision; verification = DNS resolves to us; TLS handled by Caddy on-demand), `noop` (local dev).
- Repository interfaces for `tenant_domains` and any foundation data not owned by Better Auth.

Do not add new ports speculatively — a port is added only when a second implementation or a platform difference actually exists.

### 3.6 Composition root

`apps/server/src/composition.ts` reads validated env (zod) and selects adapters:
- `DB_DRIVER=node-postgres | neon-http`
- `DOMAIN_PROVISIONER=vercel | caddy | noop`
This is the only file where env decides implementations.

### 3.7 Public surface (headless API and embeds)

Products on this foundation do NOT ship public marketing pages — creators
build their own sites (Astro/Next/plain HTML); see
[ADR-0001](decisions/0001-public-surface-embeds-over-pages.md). What the
foundation provides instead:

- **Public read-only contract routes**: a designated group of unauthenticated
  `GET` routes in `core/contract` (public data such as offers/prices in the
  product layer), served with open CORS and cacheable responses
  (`Cache-Control` with tenant-content versioning). Same zod-first contract
  discipline as the rest of the API.
- **Shareable checkout-style links**: public, tenant-domain URLs that carry a
  complete flow (e.g. checkout) without requiring the creator to host
  anything.
- **Embed endpoints (post-MVP)**: tiny server-rendered HTML widgets
  (`/embed/*`, rendered by Hono via `hono/jsx` — a typed template engine
  producing plain HTML strings, no client runtime) loaded through a script
  tag + iframe with postMessage auto-resize. Not part of the proof of concept
  or MVP.
- **Headless React SDK (recommended, pending owner confirmation)**: a thin
  published npm package with unstyled hooks/components consuming the public
  contract (types reused from `core/contract`). Would amend the "no package
  publishing" non-goal deliberately.

The authenticated application remains a static SPA (FR-16); there is no
server-side rendering of pages, only of embed widgets.

## 4. User Stories

Stories are ordered; each is one focused session. "Check passes" means `npm run check` (typecheck + lint + dependency-cruiser + knip + tests) is green.

### US-001: Repository scaffold and toolchain
**Description:** As a developer, I need the repo skeleton with strict TypeScript and test tooling so all later work has a foundation.

**Acceptance Criteria:**
- [ ] Single `package.json` (no workspaces); folder structure from §3.1 created with placeholder `index.ts` files
- [ ] `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, and path aliases `@core/*`, `@adapters/*`
- [ ] Vitest configured; one passing smoke test
- [ ] Scripts: `dev:server`, `dev:web`, `build`, `test`, `typecheck`, `lint`, `check` (aggregates all)
- [ ] `.env.example` and zod-validated env loader stub
- [ ] Check passes

### US-002: Machine-enforced boundaries
**Description:** As a developer, I want layering rules enforced by tooling so no agent or human can violate the architecture silently.

**Acceptance Criteria:**
- [ ] ESLint flat config: `eslint-plugin-boundaries` encoding all rules from §3.2; `@typescript-eslint` strict preset; `no-explicit-any` and `consistent-type-assertions` (forbid `as` except `as const`) as errors
- [ ] dependency-cruiser config: layer rules, no-circular, forbidden `@vercel/*` / `@neondatabase/*` outside allowed paths
- [ ] knip configured for dead code/exports
- [ ] Proof test: a temporary file importing `core/server` from `apps/web` makes `npm run check` fail; file removed after demonstrating (document the demonstration in the story log)
- [ ] Check passes

### US-003: Domain primitives — Result, errors, env
**Description:** As a developer, I need the shared Result type and error taxonomy so all layers speak one error language.

**Acceptance Criteria:**
- [ ] `Result<T, E>` discriminated union with `ok()/err()` helpers and narrowing tests
- [ ] `ErrorCode` closed union + `AppError` type per §3.3
- [ ] Env schema (zod) for all variables in `.env.example`; parse-don't-cast, fails fast with readable message
- [ ] Unit tests for Result helpers and env parsing
- [ ] Check passes

### US-004: API contract skeleton and error envelope
**Description:** As a developer, I need the contract package so client and server share one source of truth.

**Acceptance Criteria:**
- [ ] Envelope schemas `{ ok: true, data } | { ok: false, error }` in `core/contract`
- [ ] Health route contract (`GET /api/health` → `{ status: "ok", version }`)
- [ ] ErrorCode → HTTP status mapping table (exhaustive, tested)
- [ ] Check passes

### US-005: Hono server skeleton with composition root
**Description:** As a developer, I need a running HTTP server wired through the composition root.

**Acceptance Criteria:**
- [ ] Hono app in `apps/server` with health route implemented from contract
- [ ] `composition.ts` per §3.6 (db/domain adapters stubbed as `noop` for now)
- [ ] `entry.node.ts` serves on `PORT` (default from random high range, not 3000/8080); `curl /api/health` returns envelope
- [ ] Global error handler: unknown exceptions → `{ ok: false, error: { code: "internal" } }`, never a stack trace in the response
- [ ] Check passes

### US-006: Database adapter — Drizzle with dual drivers
**Description:** As a developer, I need Postgres persistence that works identically on Neon and in Docker.

**Acceptance Criteria:**
- [ ] Drizzle configured in `adapters/db`; driver factory selects `node-postgres` or `neon-http` from `DB_DRIVER`
- [ ] Migration tooling (`drizzle-kit`) with scripts `db:generate`, `db:migrate`
- [ ] `docker-compose.dev.yml` with `postgres:16` for local dev
- [ ] Health route extended with a DB ping through a repository interface (proves port wiring)
- [ ] Check passes

### US-007: Auth provider (identity only) and our tenancy tables
**Description:** As a user, I want to register and log in; as a developer, I want tenancy owned by foundation tables, with the auth provider supplying identity only (FR-25).

**Acceptance Criteria:**
- [ ] Better Auth mounted in `apps/server` (adapter in `adapters/auth`), schema migrated; email+password enabled; NO organization plugin
- [ ] Our tables: `tenants`, `tenant_admins` (flat roles `owner/admin`); tenant creation writes the owner row and never calls the auth provider
- [ ] `AuthPort` implemented: request → authenticated user (`userId`, email, name, verified); unit-tested with a fake
- [ ] Cookie config supports cross-subdomain sessions under `APP_BASE_DOMAIN`
- [ ] Registration + login verified via `curl` flow documented in story log
- [ ] Check passes

### US-008: Tenant resolution middleware
**Description:** As a developer, I need every request bound to a tenant context per §3.4.

**Acceptance Criteria:**
- [ ] `tenant_domains` table + repository (create/list/find-by-domain/delete), migrations applied
- [ ] Middleware resolves tenant via custom domain → subdomain → `X-Tenant` header; verifies membership; injects `Identity` with `tenantId`
- [ ] Requests to unknown domains → `tenant_not_found`; non-members → `forbidden`
- [ ] Integration tests covering all three resolution paths and both failure modes
- [ ] Check passes

### US-009: Domain use-cases and DomainPort
**Description:** As a tenant owner, I want to manage my tenant's domains through core use-cases independent of platform.

**Acceptance Criteria:**
- [ ] `DomainPort` interface per §3.5 with `noop` implementation
- [ ] Use-cases: `addTenantDomain`, `listTenantDomains`, `checkTenantDomain`, `removeTenantDomain` — owner/admin only, tenant-scoped, returning `Result`
- [ ] Contract routes for all four; wired in `apps/server`
- [ ] Unit tests with fake port + repository
- [ ] Check passes

### US-010: Typed core client
**Description:** As a client developer (CLI/web/future mobile), I want one typed client so I never hand-write HTTP.

**Acceptance Criteria:**
- [ ] `core/client` exposes typed functions for every contract route; responses deserialize into `Result<T, AppError>`
- [ ] Query/mutation definitions on `@tanstack/query-core` (framework-agnostic; no React imports — lint-verified)
- [ ] `AuthClientPort` interface defined; Better Auth client adapter implements it in `adapters/auth`
- [ ] Contract test: client against a running local server exercises health + one auth route
- [ ] Check passes

### US-011: CLI skeleton with agent-grade output
**Description:** As an AI agent, I want a CLI with structured output so I can verify every action deterministically.

**Acceptance Criteria:**
- [ ] `apps/cli` (commander): global `--json` flag; human-readable output otherwise
- [ ] Exit-code table per §3.3 implemented exhaustively (compile-time exhaustive switch)
- [ ] Config file (`~/.config/agentproofarch/config.json`): API URL, session token, active tenant slug
- [ ] Commands: `agentproofarch health`, `agentproofarch whoami`
- [ ] `--json` output is a single JSON document on stdout; logs/warnings go to stderr
- [ ] E2E test: CLI against local server, asserting stdout JSON and exit codes
- [ ] Check passes

### US-012: CLI auth commands
**Description:** As a CLI user, I want to authenticate so subsequent commands act as me.

**Acceptance Criteria:**
- [ ] `agentproofarch login` (email+password prompts or flags) stores session token; `agentproofarch logout` clears it
- [ ] `agentproofarch whoami` shows user + active tenant + role
- [ ] Wrong credentials → `unauthorized` error envelope, exit code per table
- [ ] E2E test for the login → whoami → logout cycle
- [ ] Check passes

### US-013: CLI organization commands
**Description:** As a CLI user, I want full org management from the terminal.

**Acceptance Criteria:**
- [ ] `agentproofarch org create <name>`, `org list`, `org switch <slug>`, `org members`, `org invite <email> --role <role>`
- [ ] Invitation returns a shareable invite link/token printed to stdout (no email sending in v1)
- [ ] `org switch` updates active tenant in CLI config; sent as `X-Tenant` header
- [ ] Non-admin calling `org invite` → `forbidden`, correct exit code
- [ ] E2E tests: create org → invite (second test user) → accept via API → members shows both
- [ ] Check passes

### US-014: CLI domain commands
**Description:** As a tenant owner using the CLI, I want to manage custom domains.

**Acceptance Criteria:**
- [ ] `agentproofarch domain add <domain>`, `domain list`, `domain check <domain>`, `domain remove <domain>`
- [ ] All commands respect active tenant and role; `--json` includes verification status
- [ ] E2E tests against local server with `noop` provisioner
- [ ] Check passes

### US-015: Web app scaffold
**Description:** As a developer, I need the SPA shell wired to the core client.

**Acceptance Criteria:**
- [ ] Vite + React + TanStack Router (typed routes) + TanStack Query in `apps/web`
- [ ] QueryClient consumes definitions from `core/client`; `AuthClientPort` wired via Better Auth client adapter
- [ ] Route tree: `/login`, `/register`, `/app` (authenticated layout), `/app/settings/*`
- [ ] Unauthenticated access to `/app/*` redirects to `/login`
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-016: Web auth pages
**Description:** As a user, I want to register and log in through the browser.

**Acceptance Criteria:**
- [ ] Register page: email + password, zod-validated, shows field errors from `AppError.details`
- [ ] Login page with error handling (`unauthorized` shown as human message)
- [ ] Logout action in authenticated layout
- [ ] After registration the user lands in `/app` with a personal default organization created
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-017: Web organization management and switcher
**Description:** As a user, I want to create organizations and switch between the ones I belong to.

**Acceptance Criteria:**
- [ ] Org switcher in the app header listing memberships; switching changes tenant context (subdomain redirect or header mode in dev)
- [ ] Create-organization form (name → slug preview)
- [ ] Settings page shows current org, my role
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-018: Web members and invitations
**Description:** As an org admin, I want to manage members in the browser.

**Acceptance Criteria:**
- [ ] Members list with roles; visible to all members, mutations only for owner/admin
- [ ] Invite form producing a copyable invite link; pending invitations listed and revocable
- [ ] Accept-invitation page consuming the invite token (logged-in user joins org)
- [ ] Member role change + removal (owner only), with confirmation dialog
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-019: Web domain management
**Description:** As a tenant owner, I want to manage custom domains in the browser.

**Acceptance Criteria:**
- [ ] Domains settings page: list (with verified status), add form, check button, remove with confirmation
- [ ] Add flow shows required DNS instructions (CNAME/A target from env config)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-020: Vercel domain provisioning adapter
**Description:** As an operator deploying on Vercel, I want tenant custom domains provisioned automatically.

**Acceptance Criteria:**
- [ ] `adapters/domain-provisioning/vercel.ts`: add/remove/check via Vercel Domains API (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`)
- [ ] `checkDomain` maps Vercel verification state to our `verified` flag
- [ ] Unit tests with mocked HTTP; no `@vercel/*` import outside this adapter (dependency-cruiser proves it)
- [ ] Check passes

### US-021: Caddy on-demand TLS for self-host
**Description:** As a self-hosting operator, I want custom domains to get TLS automatically with zero per-tenant config.

**Acceptance Criteria:**
- [ ] Internal endpoint `GET /internal/domain-check?domain=` returns 200 only if domain exists and is active in `tenant_domains`; unreachable from public routes (separate router, network-internal)
- [ ] `Caddyfile` with `on_demand_tls { ask }` pointing at the endpoint; reverse-proxy to app container
- [ ] `caddy` DomainPort implementation (provision = no-op; check = DNS lookup that domain resolves to configured IP/CNAME)
- [ ] Integration test for the domain-check endpoint (positive + negative)
- [ ] Check passes

### US-022: Docker self-host packaging
**Description:** As a self-hosting operator, I want the entire stack up with one command.

**Acceptance Criteria:**
- [ ] Multi-stage `Dockerfile`: builds SPA + server; final image serves API and SPA static files from one Node process
- [ ] `docker-compose.yml`: app + `postgres:16` + Caddy; migrations run on startup; healthchecks defined
- [ ] Fresh-clone test: `docker compose up` → registration and login work in a browser against `localhost` (documented in story log)
- [ ] `.env.example` covers the compose setup with sane defaults
- [ ] Check passes

### US-023: Vercel deployment target
**Description:** As an operator, I want the same commit deployable to Vercel.

**Acceptance Criteria:**
- [ ] `entry.vercel.ts` exporting the Hono handler for Vercel Functions (~5 lines); `vercel.json` routing `/api/*` to the function, everything else to the static SPA build
- [ ] `DB_DRIVER=neon-http` path verified against a Neon database (connection from env)
- [ ] Documented env matrix Vercel vs Docker in README
- [ ] Deployment checklist executed once and recorded in story log (build succeeds, health + login work on the deployment)
- [ ] Check passes

### US-024: Documentation and agent guardrails
**Description:** As an AI agent (or new developer), I want the rules discoverable where I work.

**Acceptance Criteria:**
- [ ] Root `CLAUDE.md`: architecture summary, dependency rules, "check passes" definition, CLI-first verification workflow
- [ ] Per-layer `CLAUDE.md` in `core/`, `adapters/`, `apps/` stating what may and may not be imported there
- [ ] `README.md`: what Agentproofarch is, quickstart for both deploy targets, CLI reference
- [ ] knip reports no dead exports; all scripts in README actually work
- [ ] Check passes

### US-025: Members aggregate
**Description:** As a product built on the foundation, I need end customers modeled per §3.4 so relationship data belongs to the tenant.

**Acceptance Criteria:**
- [ ] `members` table + repository (create/find/list/delete by tenant), migrations applied; no coupling to auth-provider organization tables
- [ ] Use-cases: `listMembers`, `removeMember` (owner/admin only; deletes member row + tenant-scoped data, global account untouched)
- [ ] Integration test: same email is a member of two tenants with fully independent profiles; removing one leaves the other and the account intact
- [ ] No contract route exposes a member's tenant list (test asserting FR-21)
- [ ] Check passes

### US-026: Passwordless member provisioning and magic-link sign-in
**Description:** As a product, I need to create member accounts without passwords (e.g. from a payment webhook) and let them sign in via magic link.

**Acceptance Criteria:**
- [ ] `ensureMember(tenant, email)` idempotent use-case per FR-20, exposed as an internal contract route and CLI command
- [ ] Magic-link sign-in enabled (Better Auth plugin) and working on tenant subdomains; link generation returns the URL in dev (no email delivery)
- [ ] E2E: CLI provisions a member, magic link signs them in, `whoami` shows the member context
- [ ] Check passes

### US-027: Member export
**Description:** As a tenant owner, I want to export my members so the customer relationship is portable.

**Acceptance Criteria:**
- [ ] Export use-case + contract route + CLI command: CSV and JSON, all member fields incl. email (join to account), tenant-scoped only
- [ ] Owner/admin only; forbidden for members and other tenants (tested)
- [ ] Check passes

### US-028a: Auth methods from the provider (PoC-required)
**Description:** As a user, I want to sign in with social login, passkeys or 2FA from day one, without the application knowing the provider.

**Acceptance Criteria:**
- [ ] Social login (Google at minimum), passkeys and TOTP 2FA enabled on the provider; flows exposed exclusively through `AuthClientPort`
- [ ] Grep-proof: no provider SDK import outside `adapters/auth` (lint)
- [ ] E2E: each method exercised against the local provider (social via test/dev flow) and documented in the story log
- [ ] Check passes

### US-028: Public read-only contract surface
**Description:** As a technical creator, I want public JSON endpoints so I can render commerce data on my own site.

**Acceptance Criteria:**
- [ ] Contract supports a public route group: unauthenticated GET, open CORS, cache headers with tenant content version (§3.7)
- [ ] One demo public route implemented end-to-end (e.g. public tenant profile) incl. CLI command and curl-from-another-origin test
- [ ] Public routes cannot touch tenant-scoped use-cases requiring identity (lint/test)
- [ ] Check passes

## 5. Functional Requirements

**Architecture & enforcement**
- FR-1: The system must be a single-package repository (no workspaces, no published packages) with the layout of §3.1 and path aliases.
- FR-2: All dependency rules of §3.2 must be enforced by ESLint boundaries and dependency-cruiser; any violation must fail `npm run check`.
- FR-3: TypeScript must run with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; `any` and non-const `as` assertions are lint errors.
- FR-4: All external input (HTTP bodies, CLI args, env) must be zod-parsed at the boundary; no unvalidated casts.
- FR-5: Use-cases must return `Result`; the HTTP layer must translate to the envelope of §3.3; no exception may cross the HTTP boundary as a 500 with stack trace.

**Auth & tenancy**
- FR-6: Users register/login with email+password or magic link via the auth provider behind `AuthPort`; one email maps to exactly one global account holding authentication data only.
- FR-7: A user may relate to multiple tenants: as staff (our `tenant_admins` aggregate, flat roles owner/admin) or as an end customer (our `members` aggregate). Creator registration creates a tenant with its owner row; the auth provider is not involved in tenancy.
- FR-25: The auth provider supplies identity only (`userId`, email, name, email-verification status) plus credentials/sessions and auth methods; no provider organization or team feature may be used — all relationships live in foundation tables.
- FR-26: Social login (at least Google), passkeys and 2FA (TOTP) are available from the proof of concept onwards, configured on the auth provider behind `AuthPort`/`AuthClientPort` — no application code may depend on the concrete provider's SDK for these flows.
- FR-8: An owner can grant and revoke flat admin access for additional users by email; staff invitation flows (links, emails) are post-MVP.
- FR-9: Every tenant-scoped request must resolve a tenant per §3.4 and verify membership before any use-case runs.
- FR-10: Every tenant-scoped repository method must require `tenantId`; cross-tenant data access must be impossible through the public API.

**End customers (members)**
- FR-19: End customers are `members` rows per §3.4 — never auth-provider organization members; all relationship data (profile, tags, marketing consents) is tenant-scoped.
- FR-20: `ensureMember(tenant, email)` must be an idempotent use-case that finds-or-creates a passwordless global account and the member row — callable by product code (e.g. a payment webhook); sign-in for such accounts is via magic link on the tenant's domain.
- FR-21: No API may allow a member to enumerate the tenants they belong to; tenant context comes exclusively from the domain being visited.
- FR-22: Tenant owners/admins can export all members of their tenant (CSV/JSON including email) and remove a member (deleting the member row and tenant-scoped data without touching the global account).

**Domains**
- FR-11: Tenant owners/admins can add, list, check, and remove tenant domains via API, CLI, and web.
- FR-12: On Vercel, adding a domain must register it with the Vercel project via the Domains API; on Docker, TLS must be issued on demand by Caddy after a positive `/internal/domain-check`.
- FR-13: The `/internal/domain-check` endpoint must not be reachable through the public reverse-proxied routes.

**Clients**
- FR-14: The CLI must cover every public API route of the foundation; each command supports `--json` (single JSON document on stdout) and exits with the code mapped from `ErrorCode`.
- FR-15: The web SPA must perform all data access through `core/client`; direct `fetch` calls in `apps/web` are a lint error.
- FR-16: The authenticated application is a static SPA (no SSR of pages; assets servable by both Vercel and the Node container). Server-rendered HTML exists only for `/embed/*` widgets per §3.7 (post-MVP).

**Public surface**
- FR-23: The contract must support a designated group of public, unauthenticated read-only routes served with open CORS on GET and cache headers keyed to tenant content version (§3.7).
- FR-24: Public flows (e.g. checkout) must be reachable via shareable tenant-domain URLs that require no creator-hosted page.

**Deployment**
- FR-17: The same commit must deploy to Vercel (SPA static + Hono function + Neon) and to Docker (`docker compose up` with app + Postgres + Caddy) with only env differing.
- FR-18: Database driver (`node-postgres`/`neon-http`) and domain provisioner (`vercel`/`caddy`/`noop`) must be selected exclusively in the composition root from env.

## 6. Non-Goals (Out of Scope)

- No example business resource/domain (comes in a follow-up example app built on Agentproofarch).
- No SSR of pages, no Next.js. Products on this foundation ship no public
  marketing/landing pages at all — creators bring their own sites; the
  foundation offers the public headless API and shareable flow URLs (§3.7).
  A simple hosted-pages/template system is at most a distant nice-to-have.
- No iframe embed widgets in PoC/MVP (post-MVP per §3.7).
- No central identity provider, OIDC federation or cross-instance SSO — the
  documented evolution path exists behind `AuthPort` but is not built.
- No mobile or Electron clients (future; they will consume `core/client`).
- No realtime/websockets — polling via TanStack Query is sufficient.
- No email sending (invitations are links); a MailPort may be added later when needed.
- No billing/subscriptions, no admin back-office.
- No Kubernetes, AWS, GCP; no infra beyond Vercel + docker-compose.
- No MongoDB (decision: Postgres + Drizzle; DB sits behind repository ports anyway).
- No teams/organizations concept — tenant staff is a flat owner/admin grant list; nested permissions, roles engines and staff invitation flows are out of scope (invitations post-MVP).
- No monorepo tooling (pnpm workspaces, Turborepo) and no package publishing.
  (A future headless React SDK for the public API would deliberately amend
  this non-goal — see Open Questions.)
- No i18n in v1 (UI copy in English).

## 7. Design Considerations

- UI is functional, minimal, and consistent; no design system buy-in required in v1 — plain, accessible components are fine. Visual polish is explicitly secondary to flow correctness.
- Every UI story must be verified in the browser using the dev-browser skill (see acceptance criteria).
- Error display: `AppError.message` is user-facing; `details` drives field-level form errors.

## 8. Technical Considerations

- **Hono** is the HTTP layer specifically because the identical app runs on Node and Vercel Functions; entrypoints stay ~5 lines.
- **Sessions across subdomains** require Better Auth cookie domain configuration under `APP_BASE_DOMAIN`; in local dev, tenant context can fall back to the `X-Tenant` header (same path the CLI uses).
- **Serverless connections**: the `neon-http` Drizzle driver avoids connection-pool exhaustion in functions; never use `node-postgres` on Vercel.
- **CLI token storage** in `~/.config/agentproofarch/` with `0600` permissions.
- **Ports discipline**: exactly `AuthPort`, `AuthClientPort`, `DomainPort` + repository interfaces. Adding a port requires an actual second implementation or platform difference.
- **Testing pyramid**: unit tests for core (fakes for ports), integration tests for middleware + adapters against dockerized Postgres, E2E for CLI against a locally running server. CLI E2E is the primary regression suite agents run.

## 9. Success Metrics

- `npm run check` is the single gate: green means typecheck, lint, boundaries, dependency graph, dead code, and tests all pass.
- Fresh clone → `docker compose up` → working registration/login in under 5 minutes with no manual steps beyond copying `.env.example`.
- The same commit deploys to Vercel with only env configuration.
- An agent can verify any foundation capability via CLI `--json` + exit code without a browser.
- Deliberate boundary violations (e.g. importing `core/server` from `apps/web`, importing `@vercel/*` from core) fail `npm run check` — demonstrated, not assumed.

## 10. Open Questions

- **Headless React SDK** (`useOffer`, `<BuyButton>`-style unstyled components
  over the public contract, published to npm): recommended by the
  architecture agent, awaiting owner confirmation. Amends the
  no-package-publishing non-goal.
- Should CLI login support an API-key flow (long-lived tokens for CI/agents) in addition to session tokens? Deferred unless agent workflows hit session expiry friction.
- Subdomain tenant URLs in local dev (`*.localhost` works in modern browsers) — confirm this is acceptable as the dev default, with header mode as fallback.
- Invitation link expiry policy (default proposal: 7 days, single-use).
