# Architecture

Normative reference for agentproofarch. The [PRD](prd-agentproofarch-foundation.md)
§3 is the original source; this document is its distilled, implementation-facing
form. This fork preserves the structural rules but, per [FOUNDATION.md](../FOUNDATION.md),
removed the upstream demo verticals on 2026-08-01. Product-specific examples of
todos, boards, members, staff administration, tenant creation/switching and domain
management describe upstream history, not surfaces shipped by Podpisy.

## The promise

This architecture exists so that four things stay true while agents do the
work:

1. **An agent works, and the architecture does not move.** Any volume of
   generated change lands inside the seams; no random defects appear outside
   the change, because every boundary is machine-enforced — drift is a red
   gate, not a slow surprise.
2. **The platform is replaceable without a rewrite.** Deployment target,
   database, auth provider are adapter choices behind ports; swapping one is
   a composition-root edit, never a migration of business logic.
3. **A feature enters and leaves touching nothing but its communication
   interfaces.** Adding or removing a vertical slice changes that slice and
   its declared seams — contract routes, descriptors, events — and nothing
   else.
4. **Everything is testable.** Cores are pure and test without frameworks;
   the rest is driven end-to-end by the gates — static, runtime, browser.

Every rule below serves one of these four. A rule that serves none of them
does not belong in this document. Accepted-but-deliberately-unbuilt work lives
in the [deferred-work register](backlog.md) with named triggers — this document
never carries silent gaps.

## Principles

- **Agent-first**: the primary feedback loop is the CLI — every API capability
  has a command with `--json` (one JSON envelope on stdout) and an exit code
  mapped from the error taxonomy. An agent can implement, run and verify
  features without a browser.
- **Pure core, thin edges**: business logic lives in framework-free TypeScript;
  HTTP servers, databases, auth providers and platforms are replaceable
  adapters behind ports.
- **Machine-enforced boundaries**: layer rules are lint rules
  (eslint-plugin-boundaries + dependency-cruiser), not conventions. `pnpm run
  check` is the static gate; `pnpm run smoke` is the runtime gate — it verifies
  the installed dependency tree matches the lockfile, boots the real server
  against a real database and drives health → sign-in → documents through the
  CLI, asserting taxonomy exit codes. Static-green is not done; the app must
  actually run.
- **The Vercel deploy target is built** with serverless functions and Neon.
  The deploy seed binds the configured host to the fixed `default` tenant; this
  fork ships no tenant-domain provisioning surface. **Vendor packages are contained**: `@vercel/*` and
  `@neondatabase/*` may be imported only inside `adapters/` and platform entry
  files (lint-enforced). This is dependency containment, not a ban on the
  vendor's *name* — the bare platform-detection string `VERCEL` is legitimately
  read in `apps/server/src/env.ts` and `core/server/config.ts` to select
  behavior, and that is fine; what must not leak into core is the coupling to a
  vendor SDK.

## Layers

```
core/domain     entities, Result, error taxonomy, zod schemas   → zod only
core/contract   API routes + I/O schemas + error envelope       → domain
core/server     use-cases + ports (interfaces)                  → domain, contract
core/client     typed HTTP client + query definitions           → contract
adapters/*      implement ports (db, auth, storage, email)     → core
apps/server     HTTP wiring + composition root                  → everything server-side
apps/web        SPA (no SSR)                                    → core/client (+ auth client adapter)
apps/cli        commands                                        → core/client
```

Dependency rules (enforced):

- `core/**` never imports frameworks, servers or drivers (react, hono,
  drizzle, better-auth, pg, commander).
- `core/contract` is the only bridge between server and clients; clients never
  import `core/server` or `adapters/db`.
- Server adapters are instantiated exclusively in the composition root
  (`apps/server/src/composition.ts`), where env decides implementations
  (`DB_DRIVER` selects the db driver). The
  one deliberate exception is the
  auth *client* adapter, constructed in `apps/web/src/api.ts` (web) and the
  CLI's `cliCtx`; the standalone DB operations `adapters/db/migrate.ts`,
  `adapters/db/seed.ts`, and `adapters/db/seed-deploy.ts` are also sanctioned
  composition points outside the server root. Seed needs the real auth and
  database adapters to hash credentials and persist bootstrap data, just as
  migrate needs the real database adapter.
- `@vercel/*` and `@neondatabase/*` are importable only inside `adapters/`
  (and the platform entry `api/index.ts`).
- No `any`, no `as` (except `as const`), zod-parse at every boundary.

Dependency-free is not the goal; replaceability is. Core bans *infrastructure*
(frameworks, servers, drivers — anything with a plausible second implementation
or platform difference), which lives behind ports. *Vocabulary* libraries
(zod, `@tanstack/query-core`, and the `@opentelemetry/api` no-op facade —
sanctioned for core business annotations, see §Observability) are ordinary
imports on the per-layer allowlist above — they are practically language
extensions, and swapping one would be a rewrite regardless of any abstraction. Never wrap a vocabulary library in a
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

## Vocabulary

The words this document uses precisely. Two of them — *domain* and *feature* —
are deliberately **not** synonyms.

| Term | Meaning |
|---|---|
| **Domain (business subdomain)** | A business subdomain of the product ("documents", "authentication"). Its frontend incarnation is a feature, which may contain several views or routes. |
| **`core/domain`** | The shared language layer: entities, zod schemas, domain rules, the error taxonomy. Pure, isomorphic, and there is exactly **one** — it is the "domain" of hexagonal/ports-and-adapters, the vocabulary every vertical slice speaks. |
| **Feature** | `apps/web/src/features/<name>/` — the vertical slice of a subdomain in the UI. |
| **Island** | The same feature, seen from its isolation guarantees: features are islands because lint forbids them to import each other. One word names the thing, the other names its property — "feature (island)". |
| **View** | A React component inside a feature; renders bound server actions and component-lifetime UI state. |
| **Island core (historical)** | The upstream `features/<name>/core/` pure-TS state seam. Podpisy does not ship one; the historical model is recorded below. |
| **Machine (historical)** | The state implementation behind an upstream island core. Podpisy currently uses React component state instead. |
| **Descriptors** | The typed query/mutation definitions produced by `core/client` factories (server state, TanStack) — see [server-state.md](server-state.md). |
| **Bus (historical)** | The upstream typed signal channel between island cores. No client event bus ships in Podpisy. |

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
  AppLayout.tsx     the stateful shell composition (ADR-0011): auth guard and
                    product navigation — renders components/layout/AppShell
  routes/           route components — thin: parse params, render a feature
  features/         auth/, documents/, settings/, system/: React pages and
                    components, with pure *.logic.ts helpers where needed;
                    no feature core layer ships
  components/ui/    design-system primitives → theme, lib only (no core, no features)
  components/layout/ page skeletons: structure only → theme, components/ui, lib
                    (no core, no features, no routes, no api, no TanStack)
  lib/              pure TS utilities → no react
  theme.ts          the entire visual language (MUI theme); no colors/fonts elsewhere
```

### The layout layer (page skeletons)

Decided in [ADR-0011](decisions/0011-layout-layer.md). `components/layout/` is
the one legal home for a component that owns a **page's shape** — the grid, the
widths, the sticky rails, the header/content/footer regions, the `Outlet` slot.
Before it existed a stateful shell was *unrepresentable*: features are islands so
no feature may consume one, and `components/ui/` is banned from TanStack, so the
app shell lived inside `features/settings/` for want of anywhere else. Three
properties define the layer and travel together:

- **Structure only** — grid, flex, spacing, sizing and position live here; every
  colour, font, background and border comes from `theme.ts` atoms. That is what
  makes a skeleton survive a theme change untouched.
- **Content arrives through slots** — callers pass `ReactNode` (`header`,
  `action`, `rail`, `children`); a skeleton never fetches, never names a domain
  type, never reads a route param.
- **Non-happy branches render inside the skeleton** — loading, error, empty and
  not-found are states *of* the page, not replacements for it, so width never
  jumps between a pending render and a loaded one.

**(a) Layouts are structure only.** `components/layout/**` imports `theme.ts`,
`components/ui/` and `lib/` and nothing else in the app: no `core/**`, no
`adapters/**`, no `features/**`, no `routes/**`, no `api.ts`, no TanStack.
— **TYPE**: n/a (an import edge is not a type) · **LINT**:
`web-layouts-are-structure-only` (dependency-cruiser), the same edge shape as
`web-ui-is-presentational`, plus the boundaries element type for the directory ·
**TEST**: config-regression probe — a fixture importing a feature from a layout
must fail `check` · **REVIEW+AI**: n/a (mechanically covered).

**(b) Features consume layouts; they do not define them.** A page skeleton — a
component owning a `Container`/max-width/page grid — may be defined only under
`components/layout/`. This is a rule about the *content* of a file, not about an
edge in the graph, so the mechanical half is honestly incomplete until the
structural `sx` tier below is triggered.
— **TYPE**: n/a · **LINT**: n/a today (a dependency rule cannot see a
`Container` declared in place; closes with the structural tier) · **TEST**: n/a ·
**REVIEW+AI**: the review tier owns this one — flag a feature growing its own
page grid or max-width instead of consuming a skeleton, and flag a skeleton that
appears in two features at once (that duplication is also the named trigger
below).

**Visual specs** (NORMATIVE NOW, non-required gate): every layout skeleton
carries screenshots of its states in the existing `visual/` suite on the
ADR-0008 harness — lint catches scattered `sx`, pixels catch rendered drift, and
one gate owns the pixels. No second screenshot engine.

**Structural `sx` tier** (NORMATIVE WHEN TRIGGERED — *the first case of a
duplicated page skeleton outside `components/layout/` in an app on the
foundation*): a second key category in `agentproofarch/sx-layout-only` reserving
`display`, `grid*`, `flex*` on containers, `position: sticky|fixed`, `width` and
`maxWidth` for `components/layout/**` and `theme.ts`, on the same per-file,
shrink-only, stale-erroring baseline mechanism the visual tier already uses. It
waits because the tier is unproven — it is designed in the app this layer was
graduated from and never shipped there — so the first app to hit the trigger is
also its first honest test. **Optional technique** for apps on MUI: a
`no-restricted-imports` ban on `Container`/`AppBar`/`Drawer`/`Toolbar` outside
the layout directory closes the same hole cheaply; it is MUI-specific and is not
part of the portable artifact.

**Route tree** (US-015): the public routes are `/login` and `/register`; every
authenticated surface lives under `/app`, whose layout route is the shell — split
per [ADR-0011](decisions/0011-layout-layer.md) into the chrome skeleton
(`components/layout/AppShell.tsx`: app bar, nav slots, widths, the `Outlet` slot,
no server state) and a thin stateful composition (`AppLayout.tsx`, beside
`main.tsx`) that renders it. The shell guards auth
(an anonymous hit on any `/app/*` route redirects to `/login`), owns the shared
chrome — the **logout** action and primary navigation — and renders the active
child through its `Outlet`. A caller without access to the fixed archive sees a
no-access state. `/app` redirects to `/app/documents`; the archive lives there,
and personal authentication controls live at `/app/settings`. Unknown routes
render a Polish not-found view inside the shell.
Bare `/` redirects to `/app`.

State rules:

- **Server state**: TanStack Query only, consuming **bound actions** —
  `core/client` exports query/mutation factories (including auth actions over
  `AuthClientPort`), `api.ts` binds them once, and features import ready
  actions. Feature code never holds `ApiClient`, a port or an adapter, never
  defines `queryKey`/`queryFn` inline and never touches `fetch` (all lint).
  The descriptor object is the seam — TanStack is a vocabulary dependency,
  never wrapped in a port; full usage policy in
  [server-state.md](server-state.md).
- **Client state**: the shipped archive uses component-lifetime React state and
  TanStack Query server state. The demo strip removed every island core and its
  dedicated typecheck; ADR-0005 remains a historical design record, not a claim
  that Podpisy currently implements that model.
- **URL state**: path params = resource identity, search params = shareable
  filters; neither is duplicated into component state.
- **Features are islands** (lint): a feature imports only itself. Features
  coordinate through server state (a command invalidates a scope, other
  features' queries refetch — the cache is the pub/sub, local and instant),
  through the URL, or through a route-level parent — never by importing each
  other or sharing client state. Shared code extracts downward
  (`components/ui`, `lib`, `core/client`), never sideways.
- **No stringly-typed client event bus.** An untyped bus hides coupling from
  the dependency graph — the enforcers go incomplete and control flow becomes
  slower and less reliable for agents to trace. Podpisy ships no client event
  bus; introducing one requires a named trigger and matching enforcement. Two
  features that constantly coordinate are still one feature.

### Historical upstream client application state (island cores)

**Fork status (2026-08-01): the island-core model is not present in the shipped
application.** The demo strip removed all `features/*/core/**` implementations,
`tsconfig.islands.json`, the `typecheck:islands` script, and the dedicated
api-import regression probe. The generic feature-isolation and framework-ban
lint rules remain, with their rule-presence and framework-import probes, but
`check` no longer proves a DOM-free island program or a public island factory.
The remainder of this section records the upstream design for a future named
trigger; its island-core matrices are not descriptions of current enforcement.

The upstream model is decided in
[ADR-0005](decisions/0005-client-application-state.md); this section is its
historical form. Every rule carries an explicit enforcement mini-matrix —
**TYPE / LINT / TEST / REVIEW+AI** — each cell saying *how*, or `n/a` with a
reason. A rule without a matrix is prose, and prose decays.

> **Decisions resolved (2026-07-19, owner, after the code spike).**
> (a) The rung-2 store library is **`@xstate/store`** — its event map *is*
> the events-in seam, and the same-vendor `fromStore` bridge makes rung-2→3
> graduation a supported move, not a rewrite. (b) The isomorphic-rules
> strategy is the **transition table as data** in `core/domain`, with the
> statechart derived from it and a drift test in CI (see §Isomorphic domain
> rules below). **Substitute clause**: `zustand/vanilla` is an acceptable
> rung-2 substitute only for a team that foresees no graduation to rung 3 —
> analogous to Vercel being the example deploy target, not a mandate; the
> demo always uses the first choice. The section stays written
> machine-agnostically — "island store" and "statechart" name the rungs —
> and only the lint confinement rules and the isomorphic-rules block name
> packages. Evidence and trade-offs:
> [ADR-0005](decisions/0005-client-application-state.md); the underlying spike
> report is not committed to the repo — its findings are summarized in that ADR.

**The seam.** A feature that needs client-owned state may have
`features/<name>/core/` — a pure TS module
whose public API is **events in, selectors out**. Views talk exclusively to
their own island's core; the machine inside is invisible (a view cannot tell
a store from a statechart). The core's API *is* the facade — never a generic
`IStore` interface over the state library (port theater), and the React
provider/context only delivers the core instance to the tree.
— **TYPE**: the core's public API is a closed event union + selector
functions; the machine is not exported, so views cannot type against it ·
**LINT**: `react`, `react-dom` and `@tanstack/react-query` import bans in
`features/*/core/**` (`no-restricted-imports`, mirroring the `core/**`
framework ban), and the web-wide storage-globals ban applies with no island
override · **TEST**: config-regression probe — a violating fixture must fail
`check` · **REVIEW+AI**: n/a (mechanically covered).

**CQRS at the view seam.** Events are writes (intentions), selectors are
reads; **an event never returns data**. This is the `ReadCall`/`WriteCall`
partition applied recursively at the view↔core seam — and the pattern's
survival condition: request/response over events kills it.
— **TYPE**: `dispatch` returns `void`; nothing to await, nothing to
destructure · **LINT**: n/a (the return type already forbids it) · **TEST**:
core unit tests read outcomes only through selectors after events ·
**REVIEW+AI**: flag events whose names or payloads smuggle a reply
("…Requested" handled by resolving a callback).

**The ladder + graduation triggers.** The seam is uniform; the machine
escalates. Rung 1 — **descriptors**: thin re-exports of the feature's bound
actions (the default for CRUD). Rung 2 — **island store**: real
client state driven by events. Rung 3 — **statechart (XState)**: explicit
states and transitions. A core graduates only when a measurable trigger
fires: state survives component unmount; multi-component coordination in the
island; optimistic writes spanning more than one entity; undo/redo;
validation logic with dependencies. Enumerable states with transition
legality rules trigger rung 3. The view API never changes across rungs.
— **TYPE**: identical events/selectors API on every rung (graduation is a
core-internal diff) · **LINT**: n/a (rung choice is judgment against named
triggers, not syntax) · **TEST**: n/a (nothing mechanical to assert) ·
**REVIEW+AI**: a graduating PR must name its trigger; the AI tier flags
rung-2/3 machinery with no trigger and trigger-hitting features stuck on
rung 1.

**Cardinality + the three routes.** Many views → one island core is the
norm; one view → **exactly one core, its own island's** — never another's. A
screen spanning two domains has three legal routes: **(a)** route-level
composition (the route renders both islands' views, each on its own core);
**(b)** core↔core mediation (core A subscribes to island B via bus or server
cache and re-exposes through its own selectors — its views still see one
seam); **(c)** injected app globals (session, permissions). Deleting island
B never breaks island A's views — at most typed subscriptions in A's core.
— **TYPE**: n/a (cross-island imports are already unrepresentable at lint
level) · **LINT**: `web-features-are-islands` + boundaries capture per
feature folder — a view importing another island's core is a red `check`
today · **TEST**: existing config-regression probe for the islands rule ·
**REVIEW+AI**: n/a (mechanically covered).

**The four core↔core channels** — and only these:

1. **Server cache** (default for anything durable): mutation → invalidation
   → the other core's queries refetch. The cache is the pub/sub.
2. **Typed signal bus** (ephemeral, client-only): closed union, one owning
   island per event, core-to-core only — **views never see the bus**.
3. **Injected app globals** (session, theme, permissions): a shared
   dependency injected at composition, not "communication".
4. **URL/router**: coordination through the address — shareable for free.

— **TYPE**: bus events are one closed union (exhaustive `switch`) · **LINT**:
bus module importable only from `features/*/core/**`; views importing it is
red (rule lands with the first bus event —
[frontend-lint-plan.md](frontend-lint-plan.md) Phase 5) · **TEST**:
regression probe once the bus module exists · **REVIEW+AI**:
channel choice is semantic — flag bus events that describe durable facts
(those belong to the server cache) and cores reading globals they should be
injected with.

**The two-machines contract.** The island store **never holds a copy of
server data** (it reads through the cache; optimistic updates via
`onMutate`/rollback); TanStack **never holds edit/interaction state**. The
dividing line, verbatim: **local state is state that must die on reload —
anything "save progress" is server state.**
— **TYPE**: n/a (a data shape carries no provenance) · **LINT**: ban
`useQuery`/`@tanstack/react-query` in `features/*/core/**`; ban
`queryClient.setQueryData` outside the island's `optimistic.ts`; ban the
store's persist middleware and `localStorage`/`sessionStorage` in islands
(the mechanical proxy of "dies on reload") · **TEST**: regression probe per
ban · **REVIEW+AI**: detect a server response's *shape* copied into a store
— semantics, beyond any regex.

**Optimism holds one intent per entity.** An overlay card whose op has not
settled carries an identity (client-generated id) and a position the server has
not confirmed — a second intent fired in that window targets an id the server
may not know (404) or a stale column (rule rejection), then rolls back. The
seam therefore refuses further intents on a pending entity: its action buttons
render disabled with `(saving)` in the accessible name until the op settles
(both boards; behavioral tests in each page's test file pin the closed window).

**Intent-named events.** Events name what the user did, never what should
happen: `deleteConfirmed`, not `deleteOrder`. Each island's events are a
closed union in one file, names ending in a fixed past-tense/intent suffix
taxonomy (`…Requested`, `…Confirmed`, `…Cancelled`, `…Changed`,
`…Selected`, `…Opened`, `…Closed`, `…Added`, `…Moved`, `…Removed`,
`…Failed`, `…Succeeded`).
— **TYPE**: closed union per island (exhaustive handling) · **LINT**:
`agentproofarch/event-suffix-taxonomy` on the union members — the imperative
form is unwritable ([frontend-lint-plan.md](frontend-lint-plan.md) Phase 5) ·
**TEST**: RuleTester cases for the rule · **REVIEW+AI**: the semantic half —
"do these events report intent, or smuggle a decision?" — PR checklist +
AI tier.

**Pure-TS cores (TUI-portable) — portable by construction.** An island core is
a **factory over its dependencies** (`createBoardCore(deps)`): it imports no
api.ts and no DOM. Composition moves OUT of the core — the web binding
`features/<name>/index.web.ts` is the ONE site that injects the real gateway,
the bound server-read descriptors and an id source, then re-exports the seam the
view consumes. The seam itself is `send(event)` in, `subscribe(listener)` for
change notification, and a selectors object out (including `snapshot()` for the
current overlay state); the web adapter feeds `subscribe` plus the `snapshot`
selector into `useSyncExternalStore` in one line, a TUI injects its own gateway/
descriptors and consumes `subscribe(listener)` + the selectors directly. The
descriptors thread through the factory **generically** — the core passes them to
`useQuery`/invalidation at the view but never looks inside them, so it needs no
api or query types. Direction stays lawful: a feature may import web-api
(api.ts), but web-api must not import a feature — the structural-gateway pattern
in api.ts binds the transport without api.ts reaching into the island. React in
the browser is one view adapter, not a dependency of the core.
— **TYPE**: not enforced in this fork; the dedicated no-DOM TypeScript program
was removed with the island cores · **LINT**: dormant
`features/*/core/**` framework and parent-relative import restrictions remain in
ESLint, and dependency-cruiser retains the framework-agnostic mirror · **TEST**:
config-regression proves the feature-isolation rules remain configured and that
a React import matching an island-core path fails dependency-cruiser; there is
no longer an api.ts-import probe or public-factory test · **REVIEW+AI**: any
future island-core reintroduction must restore evidence for the guarantees it
claims.

The current enforcement matrix:

| Portability property | How it is guaranteed |
| --- | --- |
| Cross-feature imports are rejected | ESLint boundaries + dependency-cruiser `web-features-are-islands`; config-regression checks the configured rules |
| A matching core imports no React framework | ESLint restrictions + dependency-cruiser `island-core-is-framework-agnostic`; config-regression feeds a React-import fixture |
| Core imports no api.ts / web composition | ESLint retains the parent-relative restriction; the dedicated regression probe was removed |
| Core typechecks without DOM | Not enforced; the no-DOM TypeScript program was removed |
| Public seam runs in plain node | Not applicable; no island core or public factory ships |
| Composition is a single lawful site | Not applicable; no `features/<name>/index.web.ts` ships |

**Isomorphic domain rules for guarded transitions.** When transition
legality is a business rule (WIP limits, an enforced status path), it is
domain logic: client-only enforcement is cosmetics — the CLI walks past it.
**Resolved (spike-verified)**: the rules live as a **transition table as
plain data** in `core/domain` — guard predicates plus a table of allowed
moves, zero new dependencies, so "zod only" stands unamended. Both sides
derive from that one table: the island **derives its XState machine
programmatically** — hand-writing the domain machine is **forbidden** — and
the server use-case derives a pure check (a few-line loop over the same
guards, no xstate in its bundle). Derivation and check **fail loud**: no
verdict produced = throw, never a permissive default. A **drift property
test in CI** sweeps enumerated board states across both derivations; it
must include WIP=1 edge limits and prove its own detection power with a
planted mutant (a hand-wired machine that drops a guard must fail the
suite). The rejected alternative — one shared machine — mismatched
board-scoped rules with a card-scoped machine (every server check rebuilt a
synthetic per-card context) and, probe-verified, **failed open** on
unhandled transitions (ADR-0005 records both reasons). Accepted cost: the
derived machine is runtime-assembled and invisible to static XState tooling
(visualizer/typegen).
— **TYPE**: both sides import the same predicate signatures from
`core/domain`; extending the table is compile-forced through exhaustive
`Record`s over the column union · **LINT**:
`core-domain-depends-on-nothing` already keeps the rules pure · **TEST**:
predicates unit-tested once in `core/domain`; the CI drift property test
asserts the derived machine and the server check agree on every enumerated
case; use-case tests assert the server rejects illegal moves ·
**REVIEW+AI**: flag rule logic re-implemented island-side instead of
imported from `core/domain`, and any hand-written (non-derived) domain
machine.

**Composing the derived machine with UI state (oracle, not owner).** The
derived machine contains **domain states only** (columns + guards) — UI
states (drag lifecycle, optimism, undo) never enter it; the failure mode is
the server "knowing" about the mouse. The island's own hand-written UI
machine treats the derived machine as an **oracle**, in either of two
sanctioned shapes:

- **Oracle-guard**: a guard in the UI machine calls the derivation's
  evaluator and reads the verdict — the shape the spike shipped:

  ```ts
  // core/domain: the single source — plain data, zero dependencies
  export const transitionTable: Readonly<Record<ColumnId, readonly GuardId[]>> = {
    todo: ['wip-limit'],
    'in-dev': ['wip-limit'],
    review: ['review-requires-in-dev', 'wip-limit'],
    done: ['done-only-from-review', 'wip-limit'],
  };

  // island core: the UI machine consults the oracle in a guard
  guards: {
    moveAllowed: ({ context, event }) =>
      evaluateMove(context.board, event.move, context.limits).allowed,
  }
  ```

  where `evaluateMove` runs one transition of the table-derived machine
  (`getNextSnapshot`) and throws if no verdict was produced.
- **Child-actor**: the UI machine `invoke`s the derived machine as a child
  actor and reads its verdict from the child's context — same oracle, actor
  plumbing instead of a guard call. Use it when the UI needs to react to
  the domain machine's state over time, not just gate a single event.

Either way the dependency points one direction: UI machine → derived domain
machine; domain states never mirror UI states back.
— **TYPE**: the derived machine's event/context types come from the table
module, so UI-state additions to it do not typecheck · **LINT**: n/a (which
machine owns a state is semantic) · **TEST**: the drift test covers the
oracle — the UI wrapper adds no domain behavior to test · **REVIEW+AI**:
flag UI states (drag, pending, undo) appearing in the table or the derived
machine, and verdict logic duplicated outside the oracle.

**Product status.** The upstream personal and team-board exemplars that once
demonstrated rungs 2 and 3 were removed from Podpisy on 2026-08-01. The ladder
remains architectural guidance, but this fork does not ship an island scaffolder
or a living board exemplar.

The action set is CQRS-partitioned: every action is either a query (safe
read) or a command (unsafe write) — no hybrids, enforced by read/write tags
flowing from contract route methods through the client types. All client
interfaces (web, CLI, future) consume the same partition.

App-level policies (the foundation prescribes the mechanism, each product
sets the numbers) — both **prescribed, not yet wired** in the demo: **bundle
budgets** — a size gate in `check` with route-level splitting; thresholds are
per app, none imposed here, and no size gate is wired yet. **Browser matrix** —
the intended default is evergreen-latest only (browserslist
`last 2 versions, not dead`); no `browserslist` config ships yet. Widening
support is a per-app decision with its own cost.

Mutations invalidate hierarchical query keys; manual cache writes only for a
single resource with rollback. Errors surface as `ApiError` carrying the
`AppError` taxonomy — rendered, never re-mapped ad hoc; a root error boundary
is mandatory. Non-trivial behavior is extracted to `*.logic.ts` and unit-tested
without rendering; component tests use real providers + MSW, never hook mocks.
React correctness (`react-hooks`, compiler, a11y, query plugins) runs at error
level in the same `pnpm run check` gate.

## Errors

Use-cases return `Result<T, AppError>` for domain errors; they do not catch
infrastructure rejections (a thrown port promise) — those are normalized once at
the composition edge (`app.onError`). This split is the decided contract
(owner ruling 2026-07-20, closing audit rider CP-4/F8): normalization stays at
the single edge, and use-cases never grow per-call try/catch for infrastructure
failures. `ErrorCode` is a closed union; the contract maps it exhaustively to HTTP
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

Authentication is separated from archive access: one global account per email
holds authentication (password, magic link, passkeys and 2FA) behind a narrow
`AuthPort`. The provider is Better Auth by default and remains replaceable.
Podpisy resolves access through the retained `tenants` and `tenant_admins`
plumbing for the fixed `default` tenant. Member, staff-administration and
tenant-management verticals are not shipped.

Product-required auth methods — magic link, social login, passkeys, 2FA —
are provider features exposed only through `AuthClientPort` and required
from the proof of concept onwards. `userId` is an opaque string: foundation
tables never FK provider tables.

No auth-provider organization/team feature is used: the provider supplies
identity only (`userId`, email and name), while archive access remains in the
application database.

Tenant resolution per request remains plumbing: exact host binding (from
`tenant_domains`) → subdomain of `APP_BASE_DOMAIN` (slug) → `X-Tenant` header.
Access is always verified. Every tenant-scoped use-case takes `ctx: { identity }` first
and every tenant-scoped repository call requires `tenantId`. Sessions span
`APP_BASE_DOMAIN` subdomains; each custom domain is its own cookie world
(sign-in per domain — deliberate isolation).

Tenant slugs are a value object (`core/domain/slug.ts`): free API input is
first **normalized** (lowercased, every run of non-alphanumerics collapsed to a
single hyphen, leading/trailing hyphens trimmed) and then **validated** against
the canonical shape (`slugSchema` = `transform(normalizeSlug).pipe(canonicalSlugSchema)`:
3–63 chars, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, not a reserved subdomain), so the edge
accepts human input while only one canonical form is ever persisted or resolved.

### Authorization

**Default-deny at every use-case entry** (NORMATIVE NOW). Tenant resolution
answers *which* tenant and *whether* the caller has archive access; authorization answers
*what* they may do there, and the two are separate steps. The capability model
lives in `core/domain/authorization.ts`: a closed `Capability` union containing
`document:read` and `document:write`, and a pure `decide(identity, capability)`
predicate over **owner**, **admin** and **visitor**. The policy is a
`Record<Capability, Principal[]>` grant table: a capability names exactly the
principals that hold it and **nothing is granted by wildcard** — a principal
absent from a capability's list is denied.

| capability       | owner | admin | visitor (tenant-less) |
| ---------------- | ----- | ----- | --------------------- |
| `document:read`  | allow | allow | deny                  |
| `document:write` | allow | allow | deny                  |

**One line per use-case.** Every tenant-scoped use-case runs the predicate — via
the `authorize` / `authorizeTenant` helpers in `core/server` — as its first
statement, **before any repository access**:

```ts
export const listDocuments = async (ctx: Ctx, deps: DocumentDeps) => {
  const scope = authorizeTenant(ctx, 'document:read'); // deny → forbidden (exit 4)
  if (!scope.ok) return scope;                      // else scope.value is the tenantId
  return ok(await deps.documents.listByTenant(scope.value, {}));
};
```

`authorizeTenant` both denies and hands back the resolved non-null `tenantId`, so
an allowed caller narrows to its tenant without a second guard and a tenant-less
caller is denied there rather than reaching a repository.

**Public routes sit BEFORE identity resolution and never authorize** (US-028,
[ADR-0006](decisions/0006-public-read-only-surface.md)). The public contract group
(`/api/public/*`, §Public surface) is unauthenticated: there is no identity, so
expressing its reads as a `visitor` capability would be dishonest — `visitor` is
an *authenticated* tenant-less principal, and a public reader is not authenticated
at all. Instead the public handlers are registered ahead of the `/api/*`
tenant-resolution middleware and call only use-cases that take **no** `ctx:
{ identity }` (e.g. `getPublicTenantProfile`), so a public handler *structurally
cannot* reach a tenant-scoped, identity-bearing use-case (the US-028 acceptance
criterion). This is enforced by a config-regression probe
(`config-regression/public-surface.test.ts`): it scans the public app for any
identity-bearing use-case name or `authorize`/`resolveIdentity` reference and
asserts the public use-case's first parameter is not `ctx: Ctx`. The default-deny
capability model is therefore untouched — public reads live *outside* it by
construction, not as a new grant row.

— **TYPE**: `Capability` is a closed union and the helpers take it as a required
argument, so a use-case cannot name a capability the union does not declare;
`Record<Capability, Principal[]>` is exhaustive, so adding a capability without
deciding its grants fails to compile. NOT type-forced (honest limit): a use-case
that never calls the predicate still compiles — the compiler forces the
capability *name*, not the *call* · **LINT**: n/a (the predicate is a call-site
discipline, not a syntactic shape a rule can match) · **TEST**: the `decide` unit
suite asserts every capability × principal cell (an exhaustive
`Record<Capability, Record<Principal, boolean>>`); each tenant-scoped use-case
test asserts owner/admin allowed and tenant-less denied; and a config-regression
**structural probe** (`config-regression/authorization.test.ts`) asserts every
exported tenant-scoped use-case (first param `ctx: Ctx`) references the
`authorize`/`authorizeTenant` helper, so a new use-case cannot silently skip
authorization — its honest limit is that it matches the helper *in the function
body* (a regex over source), not that the call precedes repository access, and an
intentional authentication-only use-case must be a named, reasoned allowlist entry,
not a silent omission · **REVIEW+AI**: flag a tenant-scoped
use-case that touches a repository before the predicate, any grant that widens a
capability to a principal the table above does not name, and any new entry added
to the probe's authentication-only allowlist without a self-scoped-read rationale.

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
invariant is mechanically checked for every currently supported tenant-scoped
aggregate — the offboarding-cascade integration test
(`adapters/db/repositories.integration.test.ts`) seeds tenant access, domain,
document and attachment rows for a throwaway tenant, deletes the tenant row,
and asserts zero rows remain while a sibling tenant is untouched.

**GDPR mechanics** (NORMATIVE WHEN TRIGGERED — trigger: first real end-user
personal data in production, beyond the demo seed). Right to access/portability is
an `exportTenantData` use-case in `core/server` that walks the tenant's aggregates
into one JSON envelope, exposed as a `--json` CLI command and a web action —
generalising the member-level export ADR-0002 already requires. Right to erasure
is the tenant cascade above plus account anonymisation: erasing a global account
removes credentials at the provider (foundation tables never FK provider tables),
and any owned-email snapshot held in member rows is tombstoned in place, not left
as PII. Until the trigger fires this is a documented use-case shape, not shipped
code — the demo carries no real personal data. The same trigger activates the
preview/staging data doctrine in §Environments (Vercel target): replace this
fork's shared Preview store with a scrubbed/seed-only isolated store, account for
that store in erasure, and keep non-production deployments behind access
protection.

**Retention** (NORMATIVE NOW) is a sink setting, not code: the application stores
no logs or traces itself and configures no app-side retention — telemetry leaves
via OTel exporters (§Observability, [observability.md](observability.md)), so
retention is Sentry's per-project window or the columnar tier's window, named
there, nothing to enforce in the repo. Operational data (jobs/outbox,
processed-events) gets a per-table prune job only when volume demands it
(§Background jobs and webhooks).

**Backups** (NORMATIVE NOW): on Vercel/Neon, disaster recovery is Neon instant
restore (branch-from-timestamp); the Free tier's **6-hour** restore window is adequate
for the demo but explicitly
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

## Data conventions

Cross-cutting column and contract conventions, decided 2026-07-20 (owner,
DECIDE C2) — settled *before* the next aggregate copies the current shape.
Each rule carries the enforcement mini-matrix from §Client application state
(**TYPE / LINT / TEST / REVIEW+AI**), because a convention without a matrix is
prose, and prose decays. Existing tables are grandfathered where noted:
documented legacy, never a template.

**Money is integer minor units plus a currency code — never floats, never bare
numbers** (NORMATIVE NOW, MANDATORY — applies to the first money-bearing
aggregate and every one after). The canonical shape is
`{ amountMinor, currency }`: `amountMinor` an integer count of the currency's
minor unit (cents/grosze), `currency` a closed ISO-4217 union — defined once as
a zod schema in `core/domain` when the first money aggregate lands, stored as
`integer`/`bigint` plus a currency column. Why integer minor units rather than
Postgres `numeric`/`decimal`: an amount crosses four decimal-hostile layers —
JSON, JS `number`, zod, TS arithmetic — and `numeric` survives none of them
(drivers surface it as a string; the first careless numeric coercion
reintroduces binary floats; JSON has no decimal type), while integer minor
units are exact in every layer, sum and compare with plain integer arithmetic,
and are the payment provider's native vocabulary (Stripe amounts *are* minor
units). A domain needing sub-cent precision (per-unit pricing, interest
accrual) scales the minor unit (micro-units) rather than switching to
decimals; formatting for humans is a view concern (`Intl.NumberFormat`), never
stored.
— **TYPE**: amounts enter the domain only through the shared money schema —
`z.number().int()` refuses fractional values at every boundary parse, and the
closed currency union refuses unknown codes at compile time · **LINT**: n/a
(no syntactic marker distinguishes a money float from any other number; the
boundary parse owns this) · **TEST**: unit tests on the money schema (rejects
`10.5`, rejects unknown currency) plus repository round-trip tests, landing
with the schema · **REVIEW+AI**: flag float arithmetic on amounts, any
`numeric`/`real`/`double` money column in a migration, and any aggregate
carrying amounts outside the shared schema.

**Timestamps are `timestamptz` for every NEW table** (NORMATIVE NOW). New
tables declare `timestamp('…', { withTimezone: true })`; the domain and
contract keep speaking ISO-8601 strings (driver-agnostic, as today) with the
mapping at the adapter's schema column. Existing tables are grandfathered:
the retained legacy tables' `created_at` columns (`tenants`, `members`, `todos` in
`adapters/db/app-schema.ts`) are text ISO-8601, and the generated Better
Auth tables use naive `timestamp` — documented legacy, deliberately **not
migrated now** (nothing ranges or sorts across zones on them; converting is a
routine expand→contract package the day a query needs index-backed time
semantics).

The demo strip deliberately writes no destructive migration. The now-unused
`members`, `todos`, `cards`, and `backfill_checkpoints` tables therefore remain
declared in `adapters/db/app-schema.ts` and in migration history; removing them
is a dedicated destructive-migration follow-up, not part of this surface strip.
— **TYPE**: n/a (the column type is a schema-file choice; TS sees a string
either way) · **LINT**: n/a today (a schema-file rule against text timestamp
columns becomes worth its fixture cost when tables multiply) · **TEST**: n/a
(nothing mechanical to assert until a range query exists) · **REVIEW+AI**: a
migration adding a text or naive-`timestamp` time column to a NEW table is
rejected; the grandfather list above is closed.

**IDs are native `uuid` for every NEW table** (NORMATIVE NOW). New tables
declare `uuid('id')` primary keys — application-minted as today (the domain
already generates ids) — and an FK column always matches the type of the key
it references, so references into legacy text PKs stay text. Native `uuid` is
16 bytes instead of 36, indexes tighter, and the storage layer rejects
malformed ids for free. Existing tables are grandfathered: `tenants`,
`tenant_admins`, `members`, `todos`, and `tenant_domains` use text ids, as do
the Better Auth tables (whose generated ids are not UUIDs at all) — documented
legacy, **not migrated now**.
— **TYPE**: n/a (both spellings surface as `string` in TS) · **LINT**: n/a
(same fixture-cost judgment as timestamps) · **TEST**: n/a · **REVIEW+AI**: a
migration adding a text PK to a NEW table is rejected unless it FK-chains to a
legacy text key; the grandfather list above is closed.

**List-endpoint pagination is cursor-based** (NORMATIVE NOW — the contract
grammar for list endpoints). Request: `?cursor=<opaque>&limit=<n>`
with a server-side cap on `limit`; the cursor is an opaque token encoding the
sort key plus an id tiebreak — never a raw offset. Response (inside the
standard `{ ok: true, data }` envelope): `{ items, nextCursor }`, where
`nextCursor` is a string to pass back or `null` on the last page. Why not
offset/limit: offsets skew under concurrent writes (rows shift between pages)
and cost the database the full skipped prefix, while a keyed cursor is stable
and index-backed. The document archive currently returns its bounded filtered
array without a cursor; if archive volume triggers pagination, it adopts this
grammar additively per §API versioning.
— **TYPE**: the envelope is one shared generic zod schema in `core/contract`
(landing with the first paginated endpoint), so later endpoints cannot invent
a rival shape without a visible new schema · **LINT**: n/a · **TEST**:
contract tests on the shared schema (cursor round-trip, `null` termination) ·
**REVIEW+AI**: flag any new list endpoint shipping offset/limit or an ad-hoc
pagination shape, and any cursor that leaks raw sort values instead of an
opaque token.

**Concurrency is last-write-wins, documented per aggregate** (NORMATIVE NOW).
Every current aggregate resolves concurrent writes by LWW — the later write
wins, unconditionally — and that is the *documented contract*, not an
accident. The document archive is operated by two trusted users; its named
upgrade is a `version` column
with optimistic concurrency (`WHERE version = $expected`, miss → the existing
`conflict` error code, exit 6), adopted **per aggregate** when its trigger
fires: the first aggregate where two writers plausibly edit the same
long-lived row and a silent lost update has real cost (collaborative
documents, billing settings). Blanket version columns on every table are
refused for the same reason blanket soft-delete is (§Data lifecycle): a
mechanism nobody exercises is a lie waiting to be believed.
— **TYPE**: n/a (LWW is the absence of a mechanism) · **LINT**: n/a ·
**TEST**: an aggregate that adopts versioning gets a conflict test (stale
version → `conflict`) with the column · **REVIEW+AI**: a new aggregate's PR
must state its concurrency stance (LWW, or version column plus the trigger
that fired); flag long-lived multi-writer aggregates claiming LWW.

**Invariant placement matrix** (DECIDE C3, owner: "nie akceptujemy żadnych
ryzyk"). Every data invariant is placed deliberately — at the database, at the
database *and* the app boundary, or app-only with a stated reason why the DB
cannot express it — and each placement carries its test. The default is **push it
to the DB**: a column constraint the database enforces cannot be bypassed by a
raw insert, a forgotten code path, or a future adapter.

| invariant | enforced where | why / test |
|---|---|---|
| `tenant_admins.role ∈ {owner, admin}` | **DB + app** | closed set → DB `CHECK` (`tenant_admins_role_check`, migration `0006`); `createTenantAccessReader` also parses the selected role with `staffRoleSchema`. Test: integration inserts a bad role via raw SQL → the DB rejects it. |
| `tenant_domains.kind ∈ {subdomain, custom}` | **DB** | closed set → DB `CHECK` (`tenant_domains_kind_check`). Test: raw-SQL bad kind → rejected. |
| `documents.doc_type ∈ {umowa-uod, uchwala, protokol, rachunek, inny}` | **DB + app** | closed set → DB `CHECK` (`documents_doc_type_check`); the adapter zod-parses on read. Test: raw-SQL bad type → rejected. |
| `document_files.role ∈ {source, signed-scan, signed-digital, other}` | **DB + app** | closed set → DB `CHECK` (`document_files_role_check`); the adapter zod-parses on read. Test: raw-SQL bad role → rejected. |
| `document_files.size_bytes ∈ [0, 25 MiB]` | **DB + app** | upload policy → DB `CHECK` (`document_files_size_check`), server body limit, direct-upload token constraint and finalize schema. Test: raw-SQL oversized file → rejected. |
| every tenant-scoped row cascades from `tenants(id)` | **DB (FK `ON DELETE CASCADE`)** | see §Data lifecycle (tenant offboarding is a schema invariant). Test: the offboarding-cascade integration test. |

— **TYPE**: closed unions surface in the domain zod schemas; the DB `CHECK`s are
the substrate mirror · **LINT**: n/a · **TEST**: as tabulated — a raw-SQL
corrupted-row probe per invariant, asserting the DB or the zod boundary rejects it
· **REVIEW+AI**: a new closed-set column ships with its `CHECK` in the same
migration (grandfather nothing silently — a plain, immediately-validated `CHECK`
proves existing rows conform or the migration fails); an app-only invariant states
why the DB cannot hold it.

**Constraint-adding migrations on production are preceded by a Neon snapshot**
(NORMATIVE NOW). A migration that adds a `CHECK`, `NOT NULL`, unique or FK
constraint validates every existing row at `ALTER` time and **fails the deploy if
any row violates** — that is the guarantee ("grandfather nothing silently"), but on
production it means the deploy can abort mid-migration. Before shipping such a
migration to a deployed environment, take a Neon branch-from-timestamp restore
point (§Data lifecycle Backups), so a violating row that only surfaces against
real data is a one-command rollback, not an incident. This includes Preview in
this fork because Preview and Production share the database; self-host uses its
own backup cadence. — **REVIEW+AI**: a constraint-adding migration's PR notes
the snapshot/PITR point taken before promotion.

## Transactions

Owner ruling (DECIDE C1, 2026-07-20): a multi-row write that must not be
observable half-done is **100% unacceptable in a transient state** — "musimy się
zastanowić jak to wymusić". This section is how it is enforced, not merely
advised.

**Per-target guarantee matrix.** The two drivers (§Layers, `DB_DRIVER`) do not
offer the same transaction primitive, so an idiom that is atomic on one and torn
on the other is a trap:

| idiom | `node-postgres` (self-host/dev) | `neon-http` (Vercel) |
|---|---|---|
| single-statement CTE / one `execute` | atomic (one statement is always its own transaction) | **atomic** (one HTTP request = one implicit transaction) |
| `db.batch([...])` (array of statements) | atomic (wrapped in one `BEGIN/COMMIT`) | **atomic** (Neon runs the array in one HTTP request/transaction) |
| interactive `db.transaction(async tx => …)` | atomic (real `BEGIN/COMMIT` on one pooled connection) | **NOT atomic** — the HTTP driver is stateless; each `tx` query is a separate request with no shared transaction, so a mid-sequence failure leaves earlier writes committed |

**Sanctioned idioms (both drivers).** A MUST-ATOMIC operation uses one of:

1. a **single-statement CTE** (`WITH … INSERT … ; INSERT … SELECT FROM …`) issued
   as one `db.execute` — the universal idiom, atomic everywhere, no driver branch.
   Use this when a future operation must write several related rows atomically.
2. **`db.batch([...])`** when the writes cannot be expressed as one statement — one
   HTTP request/transaction on `neon-http`, one `BEGIN/COMMIT` on `node-postgres`.

Interactive `db.transaction()` is **forbidden for any MUST-ATOMIC operation**
because it silently degrades to non-atomic on `neon-http`. It may be used only for
self-host-only maintenance paths that never run on Vercel, and such a path must
say so.

**MUST-ATOMIC list.** No currently shipped Podpisy use-case is on this list.

— **TYPE**: each MUST-ATOMIC operation is a single port method whose signature
takes the whole unit of work, so a use-case cannot call one half and skip the
other · **LINT**: n/a · **TEST**: an adapter test counts driver round-trips
(exactly one `execute`) for the CTE operations, and an integration test fires two
concurrent writers at the race-prone ones and asserts the invariant holds ·
**REVIEW+AI**: reject a MUST-ATOMIC operation split across two port calls, and
reject `db.transaction()` on any code path that can run on `neon-http`.

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

**Built (US-028, FR-23/FR-24, [ADR-0006](decisions/0006-public-read-only-surface.md)):**
the public read-only contract routes are live as the `PUBLIC_API_ROUTES` group in
`core/contract` — a structurally distinct registry under `/api/public/*`,
unauthenticated `GET` only. The demo route is the **public tenant profile**
(`slug`, `displayName`, `contentVersion` — never emails, access grants or documents),
served by `getPublicTenantProfile`, a use-case that takes **no identity** and runs
no `authorize`. It is registered on the main app before the `/api/*`
tenant-resolution middleware, so a public request never reaches identity
resolution (§Authorization). The route is slug-addressed, so the same URL is
shareable on the apex or any tenant domain (FR-24). Caching, CORS and versioning
are described in §HTTP caching. Not yet built: shareable checkout flows, embed
widgets, the headless SDK.

## HTTP caching

Cache policy is set at one seam — `respond()` in `apps/server/src/respond.ts`, where
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
  parity: the Node `serveStatic` path sets the same two headers, so both
  targets behave identically from one commit.
- **No `ETag`/`Last-Modified`/304 on the JSON API.** HTTP revalidation would
  duplicate the only client read cache — TanStack Query, governed by
  `staleTime`/`gcTime` (see [server-state.md](server-state.md)) — so the two
  layers never cache the same bytes and there is nothing to invalidate twice.

**NORMATIVE NOW** (triggered — the public tenant-profile group is built, US-028,
[ADR-0006](decisions/0006-public-read-only-surface.md)). The public contract group
(`/api/public/*`) opts into caching through ONE shared helper — `publicCacheControl`
in `core/contract/cache.ts` — emitting
`Cache-Control: public, max-age=0, s-maxage=<n>, stale-while-revalidate=<n>` (the
browser always revalidates, Vercel's Edge Network caches for `s-maxage` and serves
stale-while-revalidate). No call site hand-writes a `Cache-Control` string; a
config-regression probe (`config-regression/public-surface.test.ts`) asserts the
`s-maxage`/`stale-while-revalidate` tokens appear in that one helper alone. The
helper is applied at the same `respond()` seam as the `no-store` default, which
pins **errors to `no-store` regardless of the argument**, so a transient public
failure can never be cached at the edge. One platform truth the attestation must
respect: Vercel's CDN **consumes** `s-maxage`/`stale-while-revalidate` at the edge
and strips them from the client-visible header, so behind Vercel the observable
remainder is `public, max-age=0` — `smoke:remote` therefore asserts that remainder
**plus** `x-vercel-cache: HIT`/`STALE` on a repeat request (proof the edge actually
cached), while direct-to-origin smoke (local, docker) asserts the literal helper
output.

Busting is by **content-version in the URL**, not an edge purge: a content change
is a new key, which is exactly the "cache keyed to tenant content version" that
§Public surface and [ADR-0001](decisions/0001-public-surface-embeds-over-pages.md)
name. The version is `tenantContentVersion` — a pure FNV-1a derivation over the
tenant's visible public fields (`slug`, `name`), NOT a stored column, so a future
tenant-rename use-case busts the cache for free with no write-path plumbing
([ADR-0006](decisions/0006-public-read-only-surface.md) records the tradeoff). The
built shape is a tiny short-cached **discovery** route (`GET /api/public/tenants/:slug`
→ `{ slug, contentVersion }`, `s-maxage=30`) that hands a consumer the current
version, and the long-cached **profile** route
(`GET /api/public/tenants/:slug/v/:version` → the safe profile, `s-maxage=300`)
keyed on it; the path version is a cache key, not a content selector (the server
returns current content and echoes the current version, so a stale request sees
the bust in the body). Open `GET` CORS (plus its `OPTIONS` preflight) is set on
this group only via `hono/cors`, never on the authenticated `/api/*` surface — a
probe asserts the authenticated app imports no CORS middleware, and `smoke` proves
the separation from a foreign `Origin`.

**OUT OF SCOPE:** per-user `private` response caching (`no-store` is the
authenticated default), service-worker/offline HTTP-cache persistence (a product
feature, mirroring server-state.md's cache-persistence stance), platform image
optimisation (assets ship pre-hashed from Vite), and edge purge / on-demand
revalidation (public caching busts by content-version key).

## Ports (complete list)

The list below is generated from `core/server/ports.ts` (plus the one
client port in `core/client`). It is the *built* set — keep it in sync with the
code.

- `AuthPort` (server): request headers → `AuthenticatedUser | null`. Better Auth.
- `AuthClientPort` (client): sign-up/in/out **plus the provider auth methods**
  (US-026/US-028a) — `requestMagicLink`, `signInSocial`, TOTP 2FA
  (`enableTwoFactor`/`verifyTotp`/`disableTwoFactor`), and passkeys
  (`registerPasskey`/`listPasskeys`/`removePasskey`/`signInPasskey`;
  `listPasskeys` is the one read-tagged method, since the roster lives on the
  provider surface, not the contract API). Better Auth client (magic-link +
  two-factor + passkey client plugins). Every method is the EXCLUSIVE
  surface for its flow: no client names a provider route or SDK (grep-proof,
  depcruise `auth-provider-sdk-only-in-adapters-auth`).
- `EmailPort` (server): `sendMail({ to, subject, text, html?, link? })` — the one
  outbound-mail seam (US-026). `link` is the optional primary-action URL a
  transactional mail carries; a transport embeds it in the body and otherwise
  ignores the field. Two adapters in `adapters/email/`, selected by
  `EMAIL_TRANSPORT`: `smtp` (default — any RFC relay,
  Amazon SES SMTP creds included) and `ses` (Amazon SES direct over the SESv2 HTTP
  API, standard AWS_* credentials). There is **no dev transport**: dev/e2e/CI run
  the real `smtp` adapter pointed at a local **Mailpit** (docker-compose.dev.yml)
  that captures real sends instead of delivering — the magic-link smoke/e2e phases
  read the message back over Mailpit's HTTP API to recover the link, so there is
  no in-app dev route to keep off production. The magic-link sender in
  `create-auth.ts` is one consumer of `sendMail`, not the port's shape.
- `DocumentRepository`: tenant-scoped archive metadata and file records.
- `StoragePort`: private document bytes, metadata and upload targets.
- `TenantDomainRepository`, `TenantRepository`, `TenantAccessReader`: read-only
  tenant-resolution and archive-access plumbing.
- `HealthPort`: database ping for the readiness route (`/api/health/ready` and
  the compat `/api/health`); liveness never calls it.
- `IdGenerator`: injected UUID minting for deterministic use-case tests.

**BUILT** (US-026/US-028a, A1 sub-package 4): the provider auth methods that were
"normative when triggered" are now wired — this package was the trigger.
Magic-link sign-in (`AuthClientPort.requestMagicLink`, the Better Auth magic-link
plugin behind `EmailPort`), social sign-in (Google via `signInSocial`, wired only
when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are both present — the login page
reads a public `/api/config` flag to show its button), and TOTP 2FA (the Better
Auth two-factor plugin). Passkeys (`@better-auth/passkey`) are now **wired too**:
the package pinned a `better-call` whose optional `zod@^4` peer conflicted with
this tree's former `zod@^3`, so the migration to `zod@^4` was the named unblock —
done first, gates green, before the plugin went in. The server plugin registers a
`passkey` table (`0008_passkey`) scoped by `rpID = APP_BASE_DOMAIN` so one
credential works across every tenant subdomain; the client surface
(`registerPasskey`/`listPasskeys`/`removePasskey`/`signInPasskey`) is exposed
exclusively through `AuthClientPort`, driven from the settings PasskeySection and
the login page's sign-in-with-passkey button.

Add a port only when a second implementation or a platform difference actually
exists.

## Storage and email ports

Podpisy builds both binary storage for document files and transactional mail for
magic links. Both ports live in `core/server`, are
instantiated only in the composition root, and are called only from use-cases —
never from routes, never from adapters. Ports return plain `Promise`; the
use-case wraps the result in `Result<T, AppError>`, matching the existing
repository ports.

**StoragePort** — binary object persistence.

- Shape: `put`, `get`, `head`, `delete`, and `createUploadUrl` over a complete,
  server-generated storage key. Document use-cases generate tenant-prefixed keys;
  clients never choose arbitrary object paths.
- Objects are private. Reads flow through authenticated document routes, and
  direct uploads receive a constrained temporary target.
- `STORAGE_DRIVER` selects filesystem storage locally or Vercel Blob on Vercel;
  an in-memory adapter supports unit tests. Vendor imports remain in adapters.

**EmailPort** — transactional mail. **BUILT** (US-026, A1 sub-package 4; see
[ADR-0007](decisions/0007-email-port-and-magic-link-transport.md) for the shape
decision).

- Shape as built: `sendMail({ to, subject, text, html?, link? })`. No `tenantId`:
  the foundation sends from one verified domain (`EMAIL_FROM`); per-tenant branded
  senders are a when-triggered extension. `link` is the optional primary-action
  URL — a general transactional-mail concept — so the magic link is ONE consumer
  of the seam, not the port's shape.
- **Sent only from use-cases or the auth adapter's sender** (NORMATIVE): a route
  parses input and invokes a use-case; the use-case (or, for auth mail, the
  `create-auth.ts` magic-link callback) decides to mail. No route or non-auth
  adapter calls it.
- **Reliability via the outbox, not inline retries** (NORMATIVE once the outbox
  exists): when `JobsPort` lands (§Background jobs and webhooks) a use-case
  enqueues the send transactionally with its domain write. Until then the magic
  link is the only sender and its handler is idempotent (each token mints one
  session).
- Adapters as built (`adapters/email/`, selected by `EMAIL_TRANSPORT` in the
  composition root): `smtp` (default) — any RFC
  SMTP relay via nodemailer, **Amazon SES SMTP creds work unchanged** (owner
  default: "niech sobie ktoś to podmieni" — swap the relay behind the port); `ses`
  — Amazon SES **direct** over the SESv2 HTTP API (`@aws-sdk/client-sesv2`,
  standard `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), for teams
  that would rather hand SES an access key than open an SMTP port. **There is no
  dev transport.** Dev/e2e/CI run the real `smtp` adapter against a local
  **Mailpit** (docker-compose.dev.yml + the smoke/e2e CI services) that captures
  real sends like a self-hosted MailTrap; the magic-link smoke/e2e phases recover
  the link over Mailpit's HTTP API (`/api/v1/messages`, `/api/v1/message/{id}`) and
  follow it, so no in-app retrieval route ships. Composition **fails fast** when
  `ses` is selected without its AWS block (an open local Mailpit needs no SMTP
  auth, so `smtp` requires only a host). Every email-vendor SDK (nodemailer and
  `@aws-sdk/*`) is contained to `adapters/email` by depcruise
  (`smtp-sdk-only-in-adapters-email`). The originally-sketched Resend/`console`
  split was superseded by SMTP-as-universal-default
  ([ADR-0007](decisions/0007-email-port-and-magic-link-transport.md)).
- **Trigger** (already fired): US-026 magic link. The auth adapter's magic-link
  sender delegates to `EmailPort` so there is one transport and one from-address
  policy — exactly as the roadmap called for. Future non-auth transactional mail
  (order receipt, export-ready notice) reuses the same port from a use-case.

**OUT OF SCOPE:** email content/templates, sequences, marketing sends, per-tenant
sender identity, image processing/thumbnailing, virus scanning, CDN cache policy —
all app-domain, decided per product.

## Deployment

Vercel is the packaged target: `vercel.json` and `api/index.ts` provide the
serverless entry and Neon uses `DB_DRIVER=neon-http`. The deploy seed binds
`APP_BASE_DOMAIN` to the fixed `default` tenant. The Node entry and node-postgres
driver remain the local/runtime escape hatch. The required CI set is `check`,
`smoke`, and `e2e`; `visual` is
advisory and `ai-review` is separately secret-gated.

Vercel is invocation-only: no resident process, so no queue workers,
schedulers, websockets or long-running jobs. A product that needs a resident
process must supply and verify its own long-lived Node packaging.

## Environments (Vercel target)

> **Fork caveat (docu-signer, 2026-07-27).** Everything below about the public
> repo and the two rulesets describes the **upstream** wall. This fork is a
> private repo on GitHub Free where rulesets are unavailable; protection is
> procedural — see FOUNDATION.md. The section is kept as the pattern the
> discipline substitutes for.

Four environments, mapped onto Vercel's native model
([ADR-0003](decisions/0003-vercel-environments.md)), under one hard security
boundary: **only the owner can release to production, and the owner's diff review
happens before the build that sees production secrets runs.** The wall is *not*
"no GitHub event can reach production" — a merge to the `production` branch **is**
the release trigger. The wall is that the merge which triggers a production build
requires a pull request the owner alone can approve, enforced by a GitHub ruleset
with an **empty bypass list**.

**Identity split (the base of the wall).** The repo is **public**. Agents act
through a machine GitHub account, `chomamateusz-agent`, added as a **collaborator
with Write, never Admin**; the owner's own credentials (gh sessions, PATs) never
live on the agent machine. The owner's SSH key may remain on the machine, but the
rulesets neutralize it for production: SSH can push a ref but **cannot call the
API to edit a ruleset or approve a pull request**, and production requires an
approved PR. Write-not-Admin means the agent cannot edit or delete the rulesets
that bind it.

**Topology.** `main` is trunk **and** staging: every merge to `main` auto-builds a
Preview on a stable URL — the shared integration surface. The `production` branch
is the release branch, and **Vercel Production Branch Tracking is set to
`production`**. A release is the **owner** opening (or approving) a pull request
`main → production` and merging it; the approval comes from a device the agent
does not control. Because the merge to `production` is what triggers the
production build, **the owner's diff review at the PR happens *before* the
production build runs** — the correct ordering, and the specific correction over
the old dashboard-promote model, where the review ran *after* the build. The
former `staging` branch relic is deleted; `main` replaces it.

**The two rulesets (the enforced wall).** Both carry an **empty bypass list**, so
no identity — Admin included — merges past them.

| Ruleset | Branch | Enforces |
|---|---|---|
| `production-protection` | `production` | require a PR + **1 approval**, stale approvals dismissed on push, last pusher's approval required; merge method **Merge only**; required status checks `check` / `smoke` / `e2e`; block force-push; restrict deletions; empty bypass |
| `main-gates` | `main` | require a PR + **0 approvals**; merge method **Merge only**; the same three required status checks **plus `ai-review`** (the fail-closed doctrine review) **and "require branches up to date"** (the concurrent-change / F2 guard); block force-push; restrict deletions; empty bypass |

The `visual` job (pixel comparison,
[ADR-0008](decisions/0008-visual-regression.md)) is deliberately **absent** from
both lists: it reports a screenshot regression without blocking a merge until the
owner explicitly changes the fork policy; no required-check arming is planned.
The fork’s review loop
([ADR-0013](decisions/0013-visual-review-loop.md), wired 2026-07-28) posts the
baseline/actual/diff gallery into the pull request. An owner or explicitly
configured approver may use `/approve-visuals` to re-render the exact reviewed
SHA without a persisted credential; only the guarded commit step receives
`GITHUB_TOKEN` and writes the gated baselines onto that non-main PR branch. The
advisory AI read is fail-open and never a gate. This fork has no ruleset or
required-check arming for `visual`; the workflow rejects a write to `main`
explicitly.

Agents have full `main` freedom (0 approvals, gated only by the four green checks
and up-to-date-ness); `production` needs an approval the agent cannot supply for
its own PR — GitHub forbids self-approval, and the only other identity that can
approve is the owner's. That single approval, from an owner device, is the
release gate. The operating hygiene for running this under agents — secrets only
in the platform store, no production platform-CLI access on agent machines, the
owner-only release gate, and SHA attestation — is in the README's *Operating
hygiene for agent-driven repos* section (recommendations for the platform owner;
the enforced rules below are this section's). The click-by-click release runbook
is [deploy-promotion.md](deploy-promotion.md).

| Env | Git → deploy | Database | Host |
|---|---|---|---|
| Production | merge to `production` (owner-approved PR, `production-protection` ruleset) → Vercel Production build | Shared deployed Neon database | project custom domain (+ wildcard when added) |
| Staging | `main` → auto Preview deployment on a stable URL | Shared deployed Neon database | stable staging URL |
| Preview | every PR → auto Preview deployment | Shared deployed Neon database | per-PR URL |
| Development | local | Docker Postgres (or a Neon `dev` branch) | `*.localhost` |

Production, Staging, and Preview also share one Vercel Blob store. The fork
configures no per-preview Neon branch or Blob store; Vercel supplies the shared
`DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` consumed by the application.

**Preview + staging ARE the development environment** — there is no separate
deployed dev environment. Per-PR previews are where a change is exercised in a
real deployment; `main`'s auto-published staging deployment (Production Branch
Tracking points at `production`, so `main` builds a Preview, not Production) is
the shared integration surface. Both are fully automatic and fully
agent-reachable. Local (`*.localhost`) is the machine loop; every *deployed*
non-production environment is a preview or the stable staging URL.

**Tenant addressing per environment.** The server retains multi-tenant
resolution plumbing even though Podpisy exposes one fixed archive. It resolves
a tenant per request in one fixed
order (`core/server/usecases/resolve-identity.ts`): (1) an **exact
custom-domain** match in `tenant_domains`, else (2) the **subdomain label of
`APP_BASE_DOMAIN`** treated as the tenant slug, else (3) the **`X-Tenant`
header** (CLI and other non-browser clients). The consequence of step 2: with a
real owned base domain, a wildcard can resolve tenant slugs without an in-app
domain-management surface.

- **Local dev**: the archive is `default.localhost:47100`.
- **Vercel**: `db:seed:deploy` binds `APP_BASE_DOMAIN` to `default`, so each
  deployment URL serves the same fixed tenant.
- **A real base domain**: the same host binding applies. Additional subdomain or
  `X-Tenant` resolution remains core plumbing, not a user-facing feature.

Rules (RECOMMENDED topology — the normative path for apps built on this
foundation):

- **Production release goes through an owner-approved PR to `production`**
  (control 1 of 5). Production Branch Tracking points at the real `production`
  branch, and the `production-protection` ruleset (require PR + 1 approval, empty
  bypass, three required status checks) means the only way to trigger a production
  build is a pull request `main → production` that the owner approves and merges.
  An agent (`chomamateusz-agent`, Write, not Admin) can open the PR but cannot
  approve its own PR, cannot edit the ruleset, and cannot force-push past it — so
  no agent action reaches production without an owner approval from a device the
  agent does not control.
- **The release is owner-only and diff-reviewed before the build.** The owner
  reads the diff on the `main → production` PR and approves it; the merge is what
  triggers the production build. So the review precedes the build that sees
  production secrets — the correct ordering. Never an agent, never a
  self-approval.
- **Two teams, one login** (paid-app topology). The commercial app's production
  lives on its own **Pro** team; the **Hobby** team hosts non-commercial work. One
  login spans both, but a pause, suspension or plan-limit hit on one team does not
  take the other down — separate blast radius per plan, by construction.
- **Secrets live only in Vercel's env store**, scoped per environment (staging
  = branch-scoped Preview vars on Hobby). Local dev never pulls them: agent
  machines hold no platform-CLI sessions (control 2 of 5 — `vercel env pull` is
  both logged out and hook-blocked), and local development runs entirely on
  non-secret local values (`.env.example` documents every name; the dev
  database is local Docker). Nothing secret in the repo. **All production env
  vars are marked Sensitive** (write-only in the dashboard/CLI; control 3 of 5).
- **Migrations and the deploy admin seed run at build time** against the shared
  deployed database. `db:seed:deploy` runs after migration and creates
  only the `default` tenant plus the `SEED_ADMIN*` accounts and grants; it never
  invokes the local `db:seed` demo fixture. With no admin 1 pair it is a no-op.
  Preview and Production migrations are forward-only, so destructive changes
  ship as two deploys, expand → contract. A Preview build is not a database
  isolation boundary in this fork.

  **Owner ruling (2026-07-27):** the migration lineage was rebuilt wholesale in
  the skeleton-migration PR while no persistent environment existed. Every
  database predating that merge must be recreated from `0000`; forward-only
  binds from that merge onward.

  The drizzle migration sequence is mechanically gated (DECIDE F2): `pnpm run doc-lint`
  runs `lintMigrations`, which fails the build on a duplicate, gapped or
  non-`<NNNN>` prefix or a `meta/_journal.json` that does not match the `.sql`
  files on disk — a config-regression probe plants a duplicate to prove the gate
  still fires. A migration in the `main → production` diff takes a Neon
  snapshot/PITR point first (§Constraint-adding migrations; runbook step in
  [deploy-promotion.md](deploy-promotion.md)).
- **Tenant subdomains need a real wildcard base domain**; until one is
  attached, web runs single-tenant on `*.vercel.app` while the API and CLI
  stay fully multi-tenant via `X-Tenant` — which is also how `smoke` drives a
  deployed environment (`pnpm run smoke:remote` = the same CLI suite against a
  deployment URL).

**The five standing controls** (WHY and the click-by-click checklist in
[deploy-promotion.md](deploy-promotion.md) §c): (1) **owner-approved PR to
`production`** — the `production-protection` ruleset (PR + 1 approval, empty
bypass) is the only path to a production build, and the agent's account is
Write-not-Admin so it can neither self-approve nor edit the ruleset; (2) **zero
platform-CLI sessions on agent machines** — no `vercel`/`neonctl` login persists
where an agent runs, and the agent harness's Bash hook bans launching them;
(3) **all production env vars marked Sensitive** (write-only); (4) **passkey/2FA
on the Vercel login**, sessions only on owner devices; (5) **platform-independent
DR** — a cold standby on the owner's VPS via the Docker deploy target, an hourly
`pg_dump` cron on the VPS, and Neon PITR, so a total-platform loss is recoverable
off Vercel/Neon entirely.

**The irreducible residue, stated honestly.** The controls above stop an agent
from *releasing* to production without an owner approval; they do **not** remove
the fact that a **production build executes with production env vars available**
(Vercel exposes them at build, sensitive vars included) **at merge time.**
Therefore malicious build code merged to `production` could exfiltrate secrets
**before any human sees the running result** — so the defense is the owner's diff
review **at the PR, before the merge/build**, never after it. This is why the
event ordering matters: on a single Git-connected Vercel project, an agent with
repo access could, *absent the ruleset*, force a production build; the
`production-protection` ruleset (PR + owner approval, owner-only) is exactly what
closes that. But a human diff review is fallible, so build-time secret exposure
is not fully closed here. **Full closure requires either a Git-*disconnected*
production project** (secrets never reach a build triggered by a repo push) **or
production off Vercel entirely** (self-host / k3s, where an **egress allowlist**
on the production host bounds where exfiltrated secrets could go — a control
Vercel's managed functions do not offer). Both are the escalation path — the
three-tier ladder: **today** a shared laptop with the identity split above;
**at Together go-live** a managed IdP plus cheap/revocable secrets (§Two
security doctrines); **when it grows** a dedicated prod-ops machine or off-Vercel
production.

**Two security doctrines** (they keep the claims above honest):

- **TIMELINE-TRACE.** Every security claim in these docs must be justified by
  tracing the **actual** event order — who acts, when, with what privilege — not
  the *intended* order. This session alone caught three claims that were true "in
  intent" but false in timeline: an "unpushable ref" that was actually a naming
  convention; a promotion diff-review that ran **after** the build (so it could
  not defend the secret-exposure seam); and an owner SSH key assumed neutral that
  could still merge via a plain push. A claim that has not been walked step by
  step is a hypothesis, not a control.
- **CHEAP SECRETS.** The build sees **every** production secret (residue above),
  so every production secret must be **least-privilege, revocable, and
  asymmetric-verify where possible.** Offline-forge-class secrets — a symmetric
  session-signing key such as a self-hosted auth secret — should not exist on the
  platform at all: prefer an **external managed IdP** that holds the signing key
  and exposes only JWKS **verification** (a leaked verification key forges
  nothing). Managed-IdP migration is a **Together-scope** item.

**Repository scope.** The application exposes the deploy attestation and remote
smoke capabilities described here. Concrete Vercel branch tracking, rulesets,
domains, and deployment-trigger automation are repository-owner configuration.

**Per-app deployment specifics live with the app.** This section is the
foundation's recommended topology; an individual application's concrete
deployment details (its teams, domains, promotion cadence, app-specific env) are
owned by that app's own docs, not here.

**Preview/staging data doctrine** (NORMATIVE WHEN TRIGGERED — trigger: the
first real end-user personal data in production). This two-trusted-user fork
currently shares one deployed database and Blob store across Production and
Preview. If the trigger fires, isolation must be introduced before Preview can
remain an exercise surface:

- **Previews move to a scrubbed or seed-only store, never the live Production
  store.** A Neon preview branch may use a dedicated seed-only parent (or a
  scrubbed copy refreshed by a sanctioned job); opening a PR must not, by
  itself, expose live PII to preview code.
- **Preview deployments get access protection.** Per-PR URLs are shareable and
  guessable; Vercel deployment protection (or an equivalent auth wall) fronts
  every non-production deployment.
- **Any isolated Preview stores are named in the erasure story.** A seed-only
  parent keeps previews out of scope by construction; any store ever copied
  from pre-scrub Production is deleted or re-parented as part of fulfilling an
  erasure request.

— **TYPE**: n/a (environment topology is not code) · **LINT**: n/a · **TEST**:
once triggered, a CI assertion that the preview integration's parent branch is
the seed-only branch (Neon API branch metadata), same spirit as the smoke
header assertions · **REVIEW+AI**: flag any change pointing preview
provisioning at the production branch, and any erasure-related change that
ignores branches.

**Production smoke-account doctrine.** When `smoke:remote` runs against **live
production** ([ADR-0004](decisions/0004-no-exceptions-enforcement.md)), it must
be safe to run repeatedly without corrupting the tenant it touches:

- **A dedicated canary account.** The run signs in to the fixed `default` archive
  with credentials supplied by the environment.
- **Never `db:seed` against a real database.** `smoke:remote` only drives the
  public CLI/API — it never seeds. Only the isolated local `smoke` harness (its
  own throwaway `agentproofarch_smoke` DB) uses the demo seed. Deployments run
  the idempotent, admin-only `db:seed:deploy` after every build-time migration;
  it creates no demo/example data.
- **Non-self-poisoning by construction.** The authenticated drive creates one
  uniquely identified document, uploads and exports it, then removes it and
  asserts the archive returned to its starting size.
- **Credentials via CI secrets; forks override the defaults.** `SMOKE_EMAIL` /
  `SMOKE_PASSWORD` / `BASE_URL` come from repository secrets in
  CI, not the repo. The script's baked-in defaults are the local canary only; a
  fork pointing at its own deployment **must** supply its own values, and the
  `deployment_status` job is already fenced to the canonical repo.

## Health & deploy attestation

Health is split by the two questions an operator actually asks, and every health
response carries a build attestation (release `version` + commit `sha`) so a
smoke run can prove *which* deploy it verified. The `sha` is a vendor-neutral
`APP_COMMIT_SHA`; the platform entry (`api/index.ts`) maps Vercel's
`VERCEL_GIT_COMMIT_SHA` into it, so the vendor name stays contained to the one
platform boundary (§Layers). Unset (local dev) it reports `unknown`.

- **`/api/health/live` (liveness).** Always `200` as long as the process
  answers; **never touches the database**. Body: `{ status, version, sha }`. This
  is what a platform restarts a wedged container on — a DB blip must not kill a
  live process.
- **`/api/health/ready` (readiness).** Pings the database. Up → `200` with
  `{ status, version, sha, database: 'up' }`; down → the `unavailable` error
  envelope at **HTTP 503** (`exit 8`), never a `200`. This is what a load
  balancer drains traffic on.
- **`/api/health` (compat).** Kept for existing callers: `200` with
  `{ status, version, sha, database: 'up' | 'down' }` — the readiness *information*
  inline without the non-200 gate. New callers use `/live` or `/ready`; this
  endpoint reports readiness semantics but does not gate on them.

**Attestation gate.** `smoke:remote` reads caller-supplied `EXPECTED_SHA` and
asserts `health.sha === EXPECTED_SHA`, closing the "smoke verified the wrong
deployment" class (a stale alias, a promotion that didn't land). Local `smoke`
omits it (`unknown`).

Enforcement — **TYPE**: the three response shapes are zod schemas in
`core/contract` (`healthLive`/`healthReady`/`healthOutputSchema`), and `core/client`
brands its call surface from them, so no client hand-writes a health payload ·
**LINT**: n/a (route wiring is hand-registered against `API_PATHS`, like every
route) · **TEST**: `app.test.ts` asserts liveness is 200 without a DB touch,
readiness is 200/up and 503/`unavailable` when the ping fails, and the compat
route stays 200 with `sha`; `e2e` hits `/live` and `/ready` on the real stack;
`smoke:remote` runs the `EXPECTED_SHA` equality · **REVIEW+AI**: flag a health
route that pings the DB on the liveness path, a readiness path that returns 200
while degraded, or a new deploy target that surfaces the raw vendor SHA var
instead of mapping it into `APP_COMMIT_SHA`.

## Security baseline

The threat model is a multi-tenant SPA and API on one origin behind Better Auth.
The two invariants that actually hold the system together are already enforced
(§Layers, §Identity and multi-tenancy): auth runs *before* tenant resolution, and
every tenant-scoped repository method takes `tenantId`, so the type system will
not let a query span tenants; on top of those, every tenant-scoped use-case runs
a default-deny authorization predicate before it touches a repository
(§Authorization). These three are the primary access control — everything
below is defense-in-depth around them. Everything under NORMATIVE NOW is wired in
the demo (`app.ts` `secureHeaders`/`bodyLimit`, `create-auth.ts` rate limiting,
`vercel.json` headers). The `smoke` gate asserts the subset that shows up on a
live response header — `Cache-Control: no-store`, `X-Content-Type-Options:
nosniff`, the CSP's `script-src 'self'` directive, the **absence** of any
`Access-Control-Allow-Origin` on `/api/*` (the no-CORS half of the CSRF
doctrine), and the session cookie's `HttpOnly` + `SameSite=Lax` (+ `Secure` on
https) attributes from a live sign-in; the remaining NORMATIVE NOW items (body
limits, rate limiting) are covered by unit/config tests and review, not by a
live smoke assertion.

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
- **CSRF / CORS doctrine.** The primary session boundary is `SameSite=Lax`
  session cookies on a **same-origin** SPA with **no CORS middleware on the
  authenticated `/api/*` surface** — so a cross-site page can neither attach the
  session cookie on a state-changing request (`Lax` withholds it on cross-site
  sub-requests) nor read an authenticated response (no CORS = the browser blocks
  the read). Better Auth layers its own `Origin` check on `/api/auth/*` on top.
  Open `GET` CORS is set on the **future public contract group only** (§Public
  surface, §HTTP caching), never on authenticated `/api/*`. Adding `cors()` to
  `/api/*`, or relaxing `SameSite`, silently regresses this boundary — so both
  halves have a red gate:

  | Doctrine rule | Where it lives | How a regression goes red |
  |---|---|---|
  | Session cookie is `HttpOnly` + `SameSite=Lax` (+ `Secure` on https) | `create-auth.ts` (Better Auth defaults + `SECURE_COOKIES`) | `smoke` signs in with a raw POST and asserts the live `Set-Cookie` attributes |
  | No CORS middleware on authenticated `/api/*` | `app.ts` (no `cors()` mounted) | `smoke` asserts no `Access-Control-Allow-Origin` on `/api/*` |
  | Open `GET` CORS only on the public contract group | route-scoped helper (§Public surface) | added with the first public GET; authenticated `/api/*` stays uncovered |
- **Auth rate limiting.** Better Auth's built-in limiter guards **only
  `/api/auth/*`**; its default in-memory storage is useless on Vercel (every
  invocation is a fresh isolate), so set `storage: "database"` to keep counters in
  the Neon we already have — $0, no Redis. It is controlled by the
  `AUTH_RATE_LIMIT` env flag, which **defaults to on** (including in dev); set
  `AUTH_RATE_LIMIT=off` to disable it locally. It does not protect mutation
  routes, which is why those stay gated by auth + tenant scope.
- **Request body limits.** Mount Hono's `bodyLimit` on mutation routes (JSON
  payloads are small — a ~64–100KB cap is a cheap DoS floor); Vercel's 4.5MB
  serverless cap is a backstop, not policy.
- **Secrets.** Secrets live only in Vercel's env store (§Environments), parsed
  through `env.ts` so the process refuses to boot on invalid config. **Never a
  `VITE_`-prefixed secret** — Vite inlines `VITE_*` into the client bundle, so the
  prefix means public (today's only one, `VITE_SENTRY_DSN`, is a public DSN).
  `BETTER_AUTH_SECRET` is server-only and its `dev-only-secret…` default must be
  overridden with strong entropy outside local.
- **Production env hardening** (NORMATIVE NOW). The env schema (`env.ts`) does
  not merely *document* the prod requirements above — it **refuses to boot** on
  dev-only config once the process is deployed. "Deployed" is a heuristic that
  needs no new flag: `VERCEL` is set (Vercel injects it), **or** `SECURE_COOKIES`
  is on (a self-host prod turns it on). When deployed the schema rejects the
  `dev-only-secret…` `BETTER_AUTH_SECRET` sentinel and rejects
  `SECURE_COOKIES=false`; independently, `VERCEL` set forces
  `DB_DRIVER=neon-http` (the wrong driver on Vercel is a boot-time refusal, not a
  runtime surprise). Local dev and the `smoke`/`e2e` harnesses set neither
  signal, so they are never subject to these rules.
  — **TYPE**: n/a (the values are strings; the constraint is cross-field) ·
  **LINT**: n/a · **TEST**: `env.test.ts` unit-tests each refinement both ways —
  the sentinel and `SECURE_COOKIES=false` pass in local dev and fail when
  deployed, and `DB_DRIVER` passes as `neon-http` / fails as `node-postgres`
  under `VERCEL` · **REVIEW+AI**: flag any new deploy-only requirement added as
  prose-only instead of a schema refinement, and any widening of the "deployed"
  heuristic that would catch local dev.
- **Dependency hygiene.** The lockfile is committed and validated by lock-lint in
  `check`. A production-only dependency audit at `--audit-level=high` runs in CI
  as an **advisory** (reported, non-blocking — audit's false-positive rate makes a hard
  gate a build-breaker on transitive noise); a high/critical advisory is triaged,
  and version bumps come through Dependabot/Renovate PRs that pass both gates.
  The package manager is **pnpm**, chosen for install-time supply-chain hardening
  ([ADR-0009](decisions/0009-package-manager-pnpm.md)): dependency lifecycle
  scripts do not run unless the package is named in a reviewed
  `onlyBuiltDependencies` allowlist, a minimum-release-age cooldown keeps freshly
  published versions out of the install until they have aged, and the strict
  non-hoisted `node_modules` makes phantom dependencies unresolvable rather than
  merely linted. It hardens **installation**: a compromised package's runtime
  code still executes when the app imports it.
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
also on object id + event type) → do the work atomically with that insert via a
sanctioned §Transactions idiom (single-statement/batch, not an interactive
transaction on `neon-http`) → 2xx only on success, so a failure re-arms Stripe's
retry. Fulfillment is webhook-driven,
never success-page-driven (Stripe mandates this). At low volume this
synchronous pattern needs **no queue at all**.

Deferred work (email sequences, aggregations) is a first-class module whose
invariants hold on both targets:

- **State**: a queue/outbox table in the Postgres we already have. Enqueue is
  atomic with the domain write **via a sanctioned §Transactions idiom** — the
  domain row and the outbox row are written in one single-statement CTE (or one
  `db.batch`), never an interactive `db.transaction()`, which is non-atomic on
  `neon-http`. That is the implementable form of "transactional enqueue" on both
  targets; if a write genuinely cannot be expressed as one statement or batch, it
  is a self-host-only executor path (`node-postgres`) and says so. No new stateful
  infrastructure.
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
once; never step-log. The design is one W3C trace id spanning SPA → API → DB:
the seam for it lives in `core/client`'s `request()` and Hono middleware
continues an incoming one. What is wired today is narrower. **Errors** flow to
Sentry on both targets through single seams: the server installs the **Sentry
Node SDK** in `apps/server/src/observability.ts` (env-gated on `SENTRY_DSN`;
absent = a clean no-op, dev/CI untouched) as a **pure error sink** — captured at
exactly one place, `captureServerException` at `app.onError`, with no global
process hooks and no auto-instrumentation (`skipOpenTelemetrySetup`, tracing
stays OTel's) — and the web app installs the Sentry browser SDK. Like `@vercel`
and `@neondatabase`, the Sentry SDK is **contained**: `@sentry/node` lives only
in the server's composition-root sink module, `@sentry/react` only in the web's,
never in `core/**` or features (an error sink is config, not a port — port
theater). **Tracing** is narrower still: server OTLP export is optional and
env-gated; there is no OTel browser provider, so `request()`'s `traceparent`
injection reads the no-op facade and the SPA does not yet originate a trace id;
there is no DB-hop instrumentation; and the tail-sampling policy is documented,
not implemented (the actual wiring choice is DECIDE, see observability.md).
Sentry is the default sink (errors now; traces via OTLP); columnar stores
(Axiom / self-hosted ClickHouse) are the named upgrade for event analytics. The
intended tail sampling keeps all errors and slow requests and samples the happy
path. Full policy: [observability.md](observability.md).

## Foundation evolution (consuming the foundation)

How a real product is born from this repo and stays *on* the foundation. The
repository root is the reference implementation; a product is a copy that grows its own
domain. The **enforcement configuration — not the code — is the portable
artifact** that keeps the copy "agentproofarch".

**Consumption model** (NORMATIVE NOW): copy the repository root (its git history is not
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
`eslint-plugin-agentproofarch/` (the `query-descriptors-only`, `sx-layout-only`
and `event-suffix-taxonomy` rules) + `.dependency-cruiser.cjs` (`no-frameworks-in-core`,
`core-domain-depends-on-nothing`, `vercel-and-neon-only-in-adapters`,
`web-features-are-islands`, `web-layouts-are-structure-only`) for the layer and
frontend graph; and `tsconfig.json`
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
- **The repository stays exemplary** (NORMATIVE NOW): it is the fixture the gates run
  against and the thing every product forks from, so it carries only the walking
  skeleton (auth, fixed-tenant plumbing and the document archive end-to-end) —
  a change that would not generalise to every app on the
  foundation does not belong in it.

**Extract configs to a package** (NORMATIVE WHEN TRIGGERED — a real second app
exists): the enforcement configs alone MAY graduate to a versioned package (they
are domain-free — a genuine library, unlike `core`), letting apps pull rule updates
by version bump instead of by diff. This resolves the npm tension without violating
*app owns its core*. Until then, copy is simpler and $0.

**OUT OF SCOPE:** the product's domain model, business rules, and pricing/limit
numbers are the app's, never the foundation's.
