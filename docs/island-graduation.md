# How an island core graduates

This guide is read off the repo's two living boards, not from theory: the
**personal board** (`demo/apps/web/src/features/board/`, rung 2 — an
`@xstate/store` island store) and the **team board**
(`demo/apps/web/src/features/team-board/`, rung 3 — a statechart derived
from the `core/domain` transition table). Same tasks subdomain, same seam,
one rung apart — the diff between the two file trees *is* the graduation.
The rules being illustrated are normative in
[architecture.md §Client application state](architecture.md) and
[ADR-0005](decisions/0005-client-application-state.md); every path and
excerpt below is real code on `main`, so if this document and the tree ever
disagree, the tree wins and this file is the bug.

## When to graduate

ADR-0005 names the measurable triggers: state that survives component
unmount; multi-component coordination inside the island; optimistic writes
spanning more than one entity; undo/redo; validation logic with
dependencies — and, specifically for rung 3, **enumerable states with
transition legality rules**. Restated against these two file trees:

- The **personal board** sits at rung 2 because it fired the rung-2
  triggers and no more: in-flight optimistic ops and a one-step undo
  outlive any single component (`features/board/core/store.ts` holds
  `pending`, `undo`, `committedRev`), but movement is free — any card may
  enter any of `todo | doing | done`, so there is no legality question to
  encode. Its store decides *how* to apply a move, never *whether*.
- The **team board** is the same board plus exactly one new fact: a move
  can be **illegal** (WIP limits, `done` only from `review`, `review`
  requires having visited `in-dev`). Four enumerable columns with
  transition legality rules — the named rung-3 trigger, verbatim.

The trigger decides the rung; ADR-0005 §Decision 9 decides *where the
rules live*. Transition legality here is a business rule, so it does not
graduate *into the island* — it moves **down** into `demo/core/domain/`,
and the island (like the server) only derives from it. Client-only
enforcement would be cosmetics: `demo/apps/cli` walks straight past the
web UI, which is why the same table gates
`demo/core/server/usecases/cards.ts`. A rung-3 machine whose guards exist
only client-side is a smell, not a graduation.

## The diff anatomy

Side by side (only the island-owned files; tests included):

```text
features/board/                      features/team-board/
  BoardPage.tsx                        TeamBoardPage.tsx
  BoardPage.test.tsx                   TeamBoardPage.test.tsx
  index.web.ts  (web composition)      index.web.ts  (web composition)
  core/
    index.ts      (the factory)        index.ts      (the factory)
    events.ts                          events.ts
    selectors.ts                       selectors.ts
    store.ts                           store.ts
    board.test.ts                      team-board.test.ts
                                       machine.ts           <- new: derived oracle
                                       rules.drift.test.ts  <- new: drift proof

                                     core/domain/team-board.ts   <- new: the rules
                                     core/server/usecases/cards.ts  (consults them)
```

`index.web.ts` sits at the feature root, OUTSIDE `core/`: it is the ONE site that
binds the portable core to api.ts (gateway + bound descriptors, injected into the
factory) and re-exports the seam the view imports. The core itself imports no
api.ts, so it typechecks under the DOM-free `tsconfig.islands.json`
(`pnpm run typecheck:islands`) and is node-tested through its public factory — the
same for both boards, one rung apart.

### What stayed identical

**The seam.** Both `core/index.ts` files export the same factory —
`createBoardCore(deps)` / `createTeamBoardCore(deps)` — that returns the same
three-part API: `send(event)`, `subscribe(listener)`, and a selectors object.
Both `index.web.ts` files bind that factory to api.ts once (gateway + descriptors)
and re-export the seam; both views import only the `index.web.ts` module. The rung
is a core-internal secret: a view cannot tell the rung-2 board from the rung-3
team board by its seam shape, and neither core imports api.ts — composition lives
in `index.web.ts`, so the cores stay DOM-free and node-portable.

**The view wiring.** Both pages open with the same three moves — cache
read, overlay subscription, commit-driven invalidation. From
`features/board/BoardPage.tsx` (and, with names swapped,
`features/team-board/TeamBoardPage.tsx` verbatim), reading the seam through
`./index.web.js`:

```tsx
const cards = useQuery(boardSelectors.list);
const overlay = useSyncExternalStore(subscribe, boardSelectors.snapshot);

useEffect(() => {
  if (overlay.committedRev === 0) return;
  void queryClient.invalidateQueries(boardSelectors.invalidates());
}, [overlay.committedRev, queryClient]);
```

**The store skeleton.** Both `core/store.ts` files are the same
`@xstate/store` pattern: an injected gateway (pure, testable with a fake),
an overlay of `pending` ops, private `_committed`/`_rolledBack` settlement
events that never appear in the public event union, and the two-machines
contract — the store holds **no copy of the card list**; `core/selectors.ts`
merges the TanStack cache with the overlay on read.

**The taxonomy.** Both event unions are closed, intent-named, and pass the
same `agentproofarch/event-suffix-taxonomy` lint rule.

**Portability.** Neither core imports api.ts; both are factories bound in
`index.web.ts`. The property holds identically at both rungs, and every part of
it is mechanically enforced:

| Property (both boards) | Enforcer |
| --- | --- |
| Core imports no api.ts / no web path outside its dir | `no-restricted-imports` parent-relative ban · depcruise `island-core-is-portable` · config-regression probe |
| Core typechecks without DOM | `tsconfig.islands.json` (no DOM lib) → `pnpm run typecheck:islands` in `check` |
| Public seam runs in plain node | `board.test.ts` / `team-board.test.ts` drive `createBoardCore`/`createTeamBoardCore` with a fake gateway (no jsdom) |
| Composition is one lawful site | `features/<name>/index.web.ts`; api.ts stays feature-free (structural gateway) |

### What changed

**The move event became a request.** Rung 2 ships a fact; rung 3 ships a
question. `features/board/core/events.ts` has
`{ type: 'cardMoved'; ... toIndex; toColumnSize }` — the view already knows
the move will happen. `features/team-board/core/events.ts` has

```ts
| {
    type: 'cardMoveRequested';
    cardId: string;
    fromColumn: TeamColumn;
    toColumn: TeamColumn;
    board: readonly Card[];
  }
```

— a *request* carrying the merged board so the oracle can adjudicate it.
The core decides; a refused move never becomes a pending op and never
reaches the gateway. (The team board also trades the personal board's
`undo` slot for a `lastRejection` slot — a scope choice, not a rung
consequence: its demo point is "why was this refused", the sibling's is
"take it back".)

**The rules moved to `core/domain`.** `demo/core/domain/team-board.ts`
holds the whole business surface as plain data + pure predicates:
`TEAM_BOARD_COLUMNS`, `TEAM_WIP_LIMITS`, `guards`, and

```ts
export const transitionTable: Readonly<Record<TeamColumn, readonly GuardId[]>> = {
  todo: ['wip-limit'],
  'in-dev': ['wip-limit'],
  review: ['review-requires-in-dev', 'wip-limit'],
  done: ['done-only-from-review', 'wip-limit'],
};
```

plus `canApplyTeamMove` — the server-side derivation, a few-line loop over
the same table. The `Record<TeamColumn, ...>` shape is the compile-forced
completeness: extend the column union and every site fails to typecheck
until the table (and the machine's event maps) are extended too.

**The machine is derived, and consulted as an oracle.**
`features/team-board/core/machine.ts` never states a rule; `buildStates`
walks the table and emits, per `(from, to)` pair, one allow branch guarded
by all of the destination's guards plus one reject branch per guard naming
the failing rule:

```ts
const transitionsFor = (from: TeamColumn, to: TeamColumn) => {
  if (to === from) return { target: to, actions: allow };
  const guardIds = transitionTable[to];
  return [
    { target: to, guard: and(guardIds.map(passesRef)), actions: allow },
    ...guardIds.map((guardId) => ({ guard: failsRef(guardId), actions: reject(guardId) })),
  ];
};
```

The island consults it in the oracle-guard shape at two read sites and one
write site, all funneling through `evaluateTeamMove`:
`core/store.ts` gates `cardMoveRequested` before the gateway call,
`core/selectors.ts` exposes `verdictOf` so the view disables illegal
buttons with the rejecting rule as their label, and — the isomorphic half —
`core/server/usecases/cards.ts` runs `canApplyTeamMove` from the same
table before persisting:

```ts
const verdict = canApplyTeamMove(all, { cardId, toColumn }, TEAM_WIP_LIMITS);
if (!verdict.allowed) {
  return err(validation(`Move blocked by rule "${verdict.rule}"`, { rule: verdict.rule }));
}
```

UI state (pending ops, rejection display) stays in the store *around* the
oracle; drag/optimism/undo never enter the derived machine — the failure
mode being avoided is the server "knowing" about the mouse.

## The derivation contract

Graduating to rung 3 buys the guarantee "client and server can never
disagree about legality" — but only under a contract the team board keeps
in full (ADR-0005 §Spike learnings):

- **Hand-writing the domain machine is forbidden.** `machine.ts` contains
  generator code, zero rule statements. If you can point at a transition
  literal that encodes a business rule, it is a violation.
- **Fail loud, never fail open.** `evaluateTeamMove` throws when the
  machine produces no verdict (`machine produced no verdict for ...`);
  `canApplyTeamMove` returns a verdict on every branch, so no permissive
  default exists to be reached. The rejected shared-machine alternative
  answered unhandled transitions with its seeded `{ allowed: true }` —
  that hazard is why this clause exists.
- **A drift property test proves the two derivations agree.**
  `features/team-board/core/rules.drift.test.ts` enumerates the full
  (board × limits × move) product — including the WIP=1 edge limits
  (`{ todo: 1 }`, `{ done: 1 }`, ...) both spike suites had omitted — and
  asserts `evaluateTeamMove` and `canApplyTeamMove` return identical
  verdicts, rule ids included, on every scenario.
- **The suite proves its own detection power with a planted mutant.** The
  same file hand-writes a deliberately drifted machine whose
  `MOVE_TO_REVIEW` transitions drop the `review-requires-in-dev` guard —
  the classic "forgot to bind a guard" divergence — and asserts the sweep
  *catches* it. A drift test that never failed anything is vacuous; this
  one demonstrably fails the exact class of bug it exists for.
- **Clamp raw indices before the gateway, and again at the server.** The
  rung-2 store clamps `toIndex` into `[0, toColumnSize]` before its
  gateway call (`features/board/core/store.ts`); the server re-clamps in
  `moveCard` regardless. The team board sidesteps client-side index trust
  entirely (a moved card lands at the end of its destination column) and
  relies on the same server clamp.
- **`as`-free event carriers.** XState's `types` field infers the event
  union from a value, and one object literal collapses the union; under
  the no-`as` regime the carrier must be a value whose *static* type is
  already the full union — `machine.ts` indexes a
  `Record<TeamColumn, MachineEvent>` (`moveEventByColumn.todo`) instead of
  writing `{} as MachineEvent`.

## Honest costs

- **The machinery outweighs the rules.** The rules module
  (`core/domain/team-board.ts`) is ~115 lines; the derivation
  (`machine.ts`, ~170) plus the drift proof (`rules.drift.test.ts`, ~273 —
  over half of it the planted mutant) is ~440. That ratio is the price of
  the "cannot disagree" guarantee and it only amortizes when the rules are
  real; a board with no legality rules pays it for nothing, which is why
  the personal board stays rung 2.
- **The derived machine is invisible to static XState tooling.** It is
  assembled at runtime, so the visualizer and typegen see nothing
  (accepted in architecture.md §Client application state).
- **The oracle wants context, so events get heavier.** `cardMoveRequested`
  carries the merged board snapshot, and the view evaluates a verdict per
  move-button per render (`verdictOf`) — O(columns × cards) oracle runs
  per paint. Immaterial at board scale; a cost to notice before copying
  the pattern onto thousand-row data.
- **`xstate` joins the island's bundle.** The personal board ships only
  `@xstate/store`; the server check stays dependency-free (~0.4 kB, no
  xstate) — the asymmetry is the point, but the client pays for the
  machine.
- **Type-inference friction is inherited.** The `as`-free carrier trick
  and the drift test's inline transition literals (hoisting them widens
  `target`/`allowed` to `string`/`boolean` and XState's config type
  rejects them) are quirks you take on with the derivation style.
