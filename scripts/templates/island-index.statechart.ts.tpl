import { type __SINGULAR_PASCAL__Event } from './events.js';
import { __SINGULAR_CAMEL__SelectorsOf, type __SINGULAR_PASCAL__Descriptors } from './selectors.js';

export type { __SINGULAR_PASCAL__Event } from './events.js';
export type { __SINGULAR_PASCAL__Descriptors } from './selectors.js';
export { evaluate__SINGULAR_PASCAL__Move } from './machine.js';

/**
 * Public seam of the __SINGULAR_KEBAB__ island core: `send` in, selectors out.
 * A view imports ONLY the composed seam (features/__SINGULAR_KEBAB__/index.web.ts)
 * — never a machine, a descriptor or api.ts — so the machine behind the seam stays
 * invisible and swappable.
 *
 * PORTABLE BY CONSTRUCTION. This module imports no api.ts and no DOM: it is a
 * FACTORY over its dependencies. The web composition (index.web.ts) injects the
 * bound server-read descriptor once; a TUI would inject its own. The core stays
 * typecheckable without DOM (tsconfig.islands.json) and node-testable through this
 * public factory. The domain oracle (`evaluate__SINGULAR_PASCAL__Move`) is pure
 * table-derived data, so it stays part of the seam.
 *
 * RUNG 3 (statechart). The domain rules live as DATA in __RULES_PATH__;
 * core/machine.ts DERIVES an XState oracle from that table (hand-writing the
 * machine is forbidden), and `evaluate__SINGULAR_PASCAL__Move` is re-exported here
 * as the seam's oracle. `send` stays a typed stub until you add this island's own
 * hand-written UI machine and forward events to it.
 *
 * <<ORACLE-GUARD USAGE — how the derived machine composes with a UI machine>>
 * The derived machine is an ORACLE, not a place to put UI states. This island's
 * hand-written UI machine (added when you graduate `send`) CONSULTS it in a guard
 * so client and server enforce the SAME table. Example — a UI-machine guard that
 * asks the oracle whether a move is legal before it commits:
 *
 *   import { evaluate__SINGULAR_PASCAL__Move } from './machine.js';
 *   // …inside setup({ guards: { … } }):
 *   moveAllowed: ({ context }, params: { move: __SINGULAR_PASCAL__Move }) =>
 *     evaluate__SINGULAR_PASCAL__Move(context.board, params.move, context.limits).allowed,
 *
 * __RULES_INDEX_SERVER_NOTE__
 * core/rules.drift.test.ts fails CI if the derived machine and the table ever
 * disagree on any (state, event) pair. UI states NEVER enter the domain machine.
 * See docs/architecture.md §Client application state (ADR-0005).
 */
export interface __SINGULAR_PASCAL__CoreDeps<TList> {
  readonly descriptors: __SINGULAR_PASCAL__Descriptors<TList>;
}

export interface __SINGULAR_PASCAL__Core<TList> {
  send(event: __SINGULAR_PASCAL__Event): void;
  readonly __SINGULAR_CAMEL__Selectors: { readonly list: TList };
}

export const create__SINGULAR_PASCAL__Core = <TList>(
  deps: __SINGULAR_PASCAL__CoreDeps<TList>,
): __SINGULAR_PASCAL__Core<TList> => ({
  send: (event) => {
    switch (event.type) {
      case 'refreshRequested':
        // Rung-3 seam placeholder: no UI machine yet. Add a hand-written UI machine
        // that consults the oracle above, then forward events here (`actor.send`).
        break;
    }
  },
  __SINGULAR_CAMEL__Selectors: __SINGULAR_CAMEL__SelectorsOf(deps.descriptors),
});
