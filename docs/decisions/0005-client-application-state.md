# ADR-0005: Client application state — island cores with a ladder of machines

Date: 2026-07-19 · Status: accepted (2026-07-19); the two machine choices
were resolved by the owner on 2026-07-19 after a code spike (see the final
Decision block)

## Context

The architecture regulates the server-state seam completely —
[server-state.md](../server-state.md) covers descriptors, the CQRS partition,
the QueryClient policy, optimistic updates — but client application state was
one paragraph: *`useState`/`useReducer` local to the feature, context for
cross-cutting concerns, no global state libraries*. That holds for CRUD lists
and says nothing about where interaction state lives once a feature has real
client state: multi-step edits, drag lifecycles, optimistic sequences with
undo. Without a rule, every agent facing such a feature invents its own
topology — exactly the "two paths without a selection rule" failure this
architecture exists to prevent.

The gap surfaced while auditing an external (anonymized) frontend-guidelines
document. Most of that document did not survive adversarial review: strict
assumptions with zero enforcement, a hand-rolled view factory reimplementing
what React context provides, reads and writes mixed on one channel. Its
strongest concept did survive: **a framework-agnostic client core that views
talk to through events in and subscriptions out, with the state machinery
invisible behind that seam**. Five negotiation rounds hardened that concept
into this architecture's idioms (CQRS, islands, provider-delivered instances,
anti-port-theater) and produced the decisions below.

## Decision

1. **Island cores.** Every feature (island) has a `core/` module —
   `features/<name>/core/` — with one public API: **events in, selectors
   out**. Views render UI and talk exclusively to their own island's core;
   whatever machine implements the state is invisible behind that API. The
   core is the facade; there is no generic `IStore { get/set/subscribe }`
   interface over the state library (that would be port theater — re-typing a
   library's API without buying replaceability). The web provider/context only
   *delivers* the core instance to the tree; it is a delivery mechanism, not
   an abstraction.

2. **Uniform seam, ladder of machines inside.** The seam exists on every
   feature — no opt-outs, because optionality makes agents guess. What varies
   is the machine inside the core, on a three-rung ladder:
   - **Rung 1 — descriptors**: the core is thin re-exports of the feature's
     bound server-state actions (scaffolder-generated boilerplate; zero state
     library). The default for plain CRUD.
   - **Rung 2 — island store**: real client-side state (a vanilla,
     framework-free store) driven by events.
   - **Rung 3 — statechart (XState)**: explicit states and transitions, for
     processes where illegal transitions must be unrepresentable.
   A core graduates one rung only when a **measurable trigger** fires: state
   survives component unmount; multiple components in the island coordinate;
   optimistic writes span more than one entity; undo/redo; validation logic
   with dependencies. Explicitly enumerable states with legality rules for
   transitions trigger rung 3. The view API is identical on every rung —
   events and selectors — so graduation never touches views.

3. **CQRS at the view seam.** Events are writes (intentions), selectors are
   reads; **an event never returns data**. A view that needs a result of its
   own event reads it through a selector after the state changes. This is the
   `ReadCall`/`WriteCall` partition of `core/client` applied recursively, one
   level up — and the single most important boundary condition: request/
   response over events is how this pattern dies.

4. **Cardinality.** Many views → one island core: the norm. One view →
   **exactly one core: its own island's** — never another island's. A screen
   needing two domains has three legal routes: **(a) route-level
   composition** — the route/layout renders two islands' views side by side,
   each talking to its own core; **(b) core↔core mediation** — island A's core
   subscribes to island B (bus or server cache) and exposes the data through
   its own selectors, so its views still see one seam; **(c) injected app
   globals** — session, theme, permissions arrive as an injected dependency,
   not by reaching into another island. Deleting island B therefore never
   breaks island A's *views* — at most its core's typed subscriptions.

5. **Four core↔core channels**, and only these:
   1. **Server cache** (default for anything durable): core A fires a
      mutation → invalidation → core B's queries refetch. The cache is the
      pub/sub; zero coupling; survives reload.
   2. **Typed signal bus** (ephemeral, client-only): a closed union of typed
      events, each with exactly one owning island; core-to-core only —
      **views never see the bus**. Reserved for signals that never touch the
      server ("palette opened", "cell highlighted"). This is the sanctioned
      shape the architecture previously reserved "at first proven need" —
      the need is now proven; stringly-typed buses remain banned.
   3. **Injected app globals**: session, theme, permissions — a shared
      dependency injected into cores at composition, not "communication".
   4. **URL/router**: coordination through the address (deep links,
      selection) — often the best bus, because it is shareable for free.

6. **The two-machines contract.** The island store and the server cache are
   different machines with disjoint jurisdictions:
   - the island store **never holds a copy of server data** — it reads
     through the cache; optimistic updates go through `onMutate`/rollback;
   - TanStack **never holds edit/interaction state**;
   - the dividing line, verbatim normative: **local state is state that must
     die on reload — anything "save progress" is server state.**
   This is the most common degeneration path of the pattern (a store
   "temporarily" caches a list → a month later it is hand-synchronized), so
   it gets the heaviest enforcement (see architecture.md §Frontend).

7. **Intent-named events.** Events name what the user did, not what should
   happen: `deleteConfirmed`, never `deleteOrder`. The view reports intent;
   the core decides. Each island's events are one closed union in one file,
   member names ending in a past-tense/intent suffix from a fixed taxonomy
   (`…Requested`, `…Confirmed`, `…Cancelled`, `…Changed`, `…Selected`,
   `…Opened`, `…Closed`, `…Added`, `…Moved`, `…Removed`, `…Failed`,
   `…Succeeded` — the list the shipped `agentproofarch/event-suffix-taxonomy`
   rule enforces). The suffix rule cannot guarantee semantics, but it
   makes the imperative form unwritable and pushes vocabulary the right way;
   semantics is a review/AI-tier check.

8. **Pure-TS cores — portable by construction.** An island core is a pure
   TypeScript module: no React, no DOM, no `react-query`, and **no api.ts**. It
   is a **factory over its dependencies** (`createBoardCore(deps)`): composition
   moves OUT of the core into a single web binding, `features/<name>/index.web.ts`,
   which injects the real gateway, the bound server-read descriptors and an id
   source and re-exports the seam. The seam is `send(event)` in,
   `subscribe(listener)` for change notification, and a selectors object out
   (including `snapshot()` for the current overlay state); the web adapter
   feeds `subscribe` plus the `snapshot` selector into `useSyncExternalStore`
   in one line, and a TUI injects its own gateway/descriptors and consumes
   `subscribe(listener)` + the selectors directly. Same cores, two consumers —
   React in the browser is just one view adapter. The descriptors thread through
   the factory generically, so the core needs no api or query types. Direction
   stays lawful: a feature may import web-api (api.ts) but web-api never a
   feature — the structural-gateway pattern in api.ts binds the transport
   without api.ts reaching into the island. **Proven, not promised**: a
   DOM-free `tsconfig.islands.json` typechecks `features/*/core/**` as its own
   program (wired into `check` as `typecheck:islands`); a `no-restricted-imports`
   parent-relative ban plus the depcruise `island-core-is-portable` rule forbid
   a core reaching outside its own dir; and each island's public factory is
   node-tested with a fake gateway (no jsdom). This composes with what already
   holds: `core/client` is typed against `@tanstack/query-core`, and both
   candidate machines are framework-agnostic.

9. **Isomorphic domain rules for guarded transitions.** When transition
   legality is a *business* rule (WIP limits, an enforced status path), it is
   domain logic, not view logic: implemented client-only it is cosmetics — a
   CLI request would walk straight past it. Such rules live as pure
   predicates in `core/domain` (e.g. `canMoveCard(card, from, to, board)`);
   the server use-case enforces them on mutation; the island's machine wires
   the same predicates as transition guards for instant UX (blocked drop,
   with a reason). Rules once, executed on both sides. **Resolved shape
   (decision (b) below)**: the transition table as plain data in
   `core/domain` (allowed moves + guard predicates, zero dependencies), from
   which the island derives its statechart and the server derives its check
   — keeping `core/domain` zod-only. The shared-machine fallback was spiked
   and rejected (see below). The derived machine contains **domain states
   only** (columns + guards); UI states (drag lifecycle, optimism, undo)
   stay in a client-side layer around it — the failure mode is the server
   "knowing" about the mouse.

**Resolved by the spike + owner decision** (status: decided 2026-07-19;
everything above stays machine-agnostic — "island store" and "statechart"
name the rungs; these two decisions name the libraries):

- **(a) Rung-2 store library: `@xstate/store`.** WHY: its event map *is* the
  events-in seam — the store's `on: { cardAdded: … }` keys mirror the
  island's event union one-to-one with zero explicit generics and zero
  casts — and the same-vendor `fromStore` bridge makes rung-2→rung-3
  graduation a supported move instead of a rewrite. **Substitute clause**:
  `zustand/vanilla` is an acceptable substitute ONLY for a team that
  foresees no graduation to rung 3 — analogous to Vercel being the example
  deploy target, not a mandate. The demo always uses the first choice.
- **(b) Isomorphic-rules strategy: transition-table-as-data.** The table
  (allowed moves + guard predicates) lives as plain data in `core/domain`
  with **zero dependencies** — "zod only" stands unamended. The island's
  XState machine is **derived from the table programmatically —
  hand-writing the machine is forbidden** — and the server check is derived
  from the same table (a few-line pure loop); a **drift property test in
  CI** proves the two derivations agree. WHY: compiler-forced completeness
  (extending the table is a tour of exhaustive `Record`s the compiler will
  not let you skip), fail-loud evaluation (no verdict produced = throw),
  and domain purity (the server check bundles at ~0.4 kB with no xstate).
  The shared-machine alternative (B2) is **rejected** for two spike-proven
  reasons: the rules are *board-scoped* while the machine is *card-scoped*
  — every server check had to rebuild a synthetic per-card context around a
  board-global question — and it **fails open**: probe-verified, an
  unhandled transition returned its placeholder verdict
  `{ allowed: true }` as the server's answer.

**Evidence.** A code spike with **five implementations** over one shared
behavior suite (rung 2: `zustand/vanilla`, `@xstate/store`, and a
full-XState reference; isomorphic rules: table-as-data vs shared machine),
judged by **two independent judge panels** whose disagreements were settled
by an adjudicator with **verified runtime probes** (fail-open, index
clamping, interleaving, subscription granularity — each reproduced against
the code, not argued). Both panels independently picked `@xstate/store` and
the table. The full spike report and the decision-context notes
(`spike-report.md`, `island-core-grill-5.md`) are **not committed** to this
repo; their conclusions and probe results are summarized in this ADR.

**Spike learnings — implementation requirements for the demo boards:**

- **Fail loud on unhandled transitions.** The derived machine/check throws
  when no verdict is produced; never seed a permissive initial verdict —
  the fail-open hazard is exactly what sank the shared machine.
- **Clamp raw payload indices (`toIndex`) before the gateway call**, not
  only in optimistic state — both rung-2 spike stores forwarded raw
  indices, so persisted order could silently diverge from optimistic
  order; the server re-clamps regardless.
- **Drift property tests must cover WIP=1 edge limits** (both spike suites
  omitted `{todo: 1}`/`{done: 1}`) and must demonstrate their own detection
  power with a planted mutant (a hand-wired machine that drops a guard must
  make the suite fail).
- **The `as`-free event-carrier typing trick.** XState's `types` field
  infers the event union from a value, and a single object literal
  collapses the union; under the no-`as` regime, pass a value whose
  *static* type is already the full union (index a
  `Record<ColumnId, MachineEvent>`), never `{} as MachineEvent`.

## Consequences

- **Honest cost: the seam taxes simple features.** A rung-1 core is extra
  files where `useQuery(actions.todos)` was two lines. Mitigation: rung 1 is
  scaffolder-generated re-export boilerplate, and uniformity is what removes
  agent guesswork — you pay a fixed small tax to make every feature look the
  same, instead of a variable large one when agents improvise topologies.
- **Enforcement surface grows.** New lint rules (event-suffix taxonomy, core
  purity bans, persistence bans, `setQueryData` confinement — see
  [frontend-lint-plan.md](../frontend-lint-plan.md) Phase 5) plus
  config-regression probes for each. Every normative rule in the architecture
  section ships an explicit TYPE/LINT/TEST/REVIEW+AI enforcement matrix.
- **The two-machines contract is only partially lintable.** The bans are
  mechanical; copying the *shape* of a server response into a store is
  semantic and stays a review + AI-tier check — acknowledged residual risk.
- **This narrows, not reverses, the earlier "no client event bus" decision.**
  The rationale against stringly-typed buses (coupling hidden from the
  dependency graph) stands; what is sanctioned is exactly the closed-union
  escape hatch that decision reserved, now with a proven need, an owner per
  event, and a views-never-touch-it rule.
- **The demo gains two exemplar boards** (personal = rung 2 on
  `@xstate/store`, team = rung 3 with the table-derived machine), two
  islands over one tasks subdomain — unblocked now that (a) and (b) are
  decided; both boards must satisfy the spike-learnings implementation
  requirements above.

  > **Landed (2026-07-20).** Both boards now exist in the tree
  > (`demo/apps/web/src/features/board/` with its `core/` island store, and
  > `demo/apps/web/src/features/team-board/` with its `core/` over the
  > `demo/core/domain/team-board.ts` transition table). Every *other* demo
  > feature (todos, auth) remains rung 1 and honestly so — none fires a
  > graduation trigger; the pre-existing features still carry no explicit
  > `core/` folder and gain one when first touched by real client state. New
  > islands start from `pnpm run new:island`, which scaffolds the rung-1 seam.
  >
  > **Portable by construction (landed 2026-07-21).** Both cores were made
  > genuinely portable: `core/index.ts` no longer imports api.ts but exports a
  > `createBoardCore`/`createTeamBoardCore` factory, bound once in the new
  > `features/<name>/index.web.ts` web composition (gateway + descriptors
  > injected there); views import the seam from that binding. Enforcement now
  > matches the claim — `tsconfig.islands.json` (no DOM) runs as
  > `typecheck:islands` in `check`, a `no-restricted-imports` parent-relative
  > ban and the depcruise `island-core-is-portable` rule keep cores from
  > importing api.ts or any web path outside their own dir (config-regression
  > probe included), and each island's public factory is node-tested with a fake
  > gateway. The TUI claim is now literal: **typechecked without DOM, public
  > seam node-tested.** `new:island` scaffolds this shape (a per-rung
  > `index.web.ts` + a factory core).
  >
  > **Two scaffolders, one story (reconciled 2026-07-20).** `new:resource`
  > owns the server/data slice and ships a rung-0 CRUD page that reads
  > `actions.<name>` directly — a coreless starting point (like the todos
  > page), **not** an exemption from decision 2's "no opt-outs". Its checklist
  > and the generated page both name the graduation path: when the feature
  > grows client state, `pnpm run new:island -- <name>` plants the rung-1 seam
  > and the page reads through `<name>Selectors.list` instead of api.ts. The
  > island scaffolder is the one that enforces the uniform seam; the resource
  > scaffolder points at it rather than silently minting a seam-less feature.
- The one-paragraph "Client state" rule in architecture.md §Frontend is
  superseded by the island-core model (rewritten in the same change as this
  ADR).
