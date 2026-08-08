import type { __SINGULAR_PASCAL__Event } from './events.js';
import { __SINGULAR_CAMEL__SelectorsOf, type __SINGULAR_PASCAL__Descriptors } from './selectors.js';

export type { __SINGULAR_PASCAL__Event } from './events.js';
export type { __SINGULAR_PASCAL__Descriptors } from './selectors.js';

/**
 * Public seam of the __SINGULAR_KEBAB__ island core: `send` in, selectors out.
 * A view imports ONLY the composed seam (features/__SINGULAR_KEBAB__/index.web.ts)
 * — never a store, a descriptor or api.ts — so the machine behind the seam stays
 * invisible and swappable.
 *
 * PORTABLE BY CONSTRUCTION. This module imports no api.ts and no DOM: it is a
 * FACTORY over its dependencies. The web composition (index.web.ts) injects the
 * bound server-read descriptor once; a TUI would inject its own. The core stays
 * typecheckable without DOM (tsconfig.islands.json / `pnpm run typecheck:islands`)
 * and node-testable through this public factory.
 *
 * `send` is the events-in entry point. RUNG 1 has no client machine, so it is a
 * typed, exhaustive stub: an intent that needs state which outlives a render or
 * coordinates several views is the trigger to graduate the island, and server
 * writes go through mutation descriptors in the view (invalidation → refetch).
 *
 * <<EXTENSION POINT — machine>>
 * When a graduation trigger fires, create the machine in this module and forward
 * events to it: rung 2 → an @xstate/store store, `store.send(event)` (scaffold
 * shape: `--machine=store`); rung 3 → a UI actor consulting the table-derived
 * oracle, `actor.send(event)` (`--machine=statechart`). The view's call —
 * `send({ type: '…Requested' })` — never changes (ADR-0005, decided). See
 * docs/architecture.md §Client application state.
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
        // Rung 1 placeholder: no client state to change yet. Graduate to a store
        // when an intent must change state that outlives a render or coordinates
        // multiple views.
        break;
    }
  },
  __SINGULAR_CAMEL__Selectors: __SINGULAR_CAMEL__SelectorsOf(deps.descriptors),
});
