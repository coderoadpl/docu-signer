import { type __SINGULAR_PASCAL__Event } from './events.js';
import { __SINGULAR_CAMEL__SelectorsOf, type __SINGULAR_PASCAL__Descriptors } from './selectors.js';
import {
  canUndoOf,
  create__SINGULAR_PASCAL__Store,
  __SINGULAR_CAMEL__ItemsOf,
  type MergedItem,
  type ServerItem,
  type __SINGULAR_PASCAL__Gateway,
  type __SINGULAR_PASCAL__OverlayState,
} from './store.js';

export type { __SINGULAR_PASCAL__Event } from './events.js';
export type { __SINGULAR_PASCAL__Descriptors } from './selectors.js';
export type { MergedItem, ServerItem, __SINGULAR_PASCAL__Gateway } from './store.js';

/**
 * Public seam of the __SINGULAR_KEBAB__ island core: `send` in, selectors out.
 * A view imports ONLY the composed seam (features/__SINGULAR_KEBAB__/index.web.ts)
 * — never the store, a descriptor or api.ts — so the machine behind the seam stays
 * invisible and swappable.
 *
 * PORTABLE BY CONSTRUCTION. This module imports no api.ts and no DOM: it is a
 * FACTORY over its dependencies. The web composition (index.web.ts) injects the
 * real gateway, the bound server-read descriptor and an id source once; a TUI
 * would inject its own. The core stays typecheckable without DOM
 * (tsconfig.islands.json) and node-testable through this public factory.
 *
 * RUNG 2 (island store). `send` forwards every event to the @xstate/store store
 * (core/store.ts). The injected `list` descriptor stays the cache truth; `items`
 * merges it with the store's optimistic overlay (the store keeps NO item copy);
 * the view subscribes with `useSyncExternalStore(subscribe, snapshot)` and
 * invalidates the cache once `snapshot().committedRev` advances. The view's calls
 * never change across rungs. This mirrors the living personal board core.
 */
export interface __SINGULAR_PASCAL__CoreDeps<TList> {
  readonly gateway: __SINGULAR_PASCAL__Gateway;
  readonly descriptors: __SINGULAR_PASCAL__Descriptors<TList>;
  readonly generateId: () => string;
}

export interface __SINGULAR_PASCAL__Core<TList> {
  send(event: __SINGULAR_PASCAL__Event): void;
  subscribe(listener: () => void): () => void;
  readonly __SINGULAR_CAMEL__Selectors: {
    readonly list: TList;
    snapshot(): __SINGULAR_PASCAL__OverlayState;
    items(serverItems: readonly ServerItem[]): readonly MergedItem[];
    canUndo(): boolean;
  };
}

export const create__SINGULAR_PASCAL__Core = <TList>(
  deps: __SINGULAR_PASCAL__CoreDeps<TList>,
): __SINGULAR_PASCAL__Core<TList> => {
  const store = create__SINGULAR_PASCAL__Store({ gateway: deps.gateway, generateId: deps.generateId });
  return {
    send: (event) => {
      store.send(event);
    },
    subscribe: (listener) => store.subscribe(listener),
    __SINGULAR_CAMEL__Selectors: {
      // Server read (rung-1 seam, unchanged): the fresh list via TanStack Query.
      ...__SINGULAR_CAMEL__SelectorsOf(deps.descriptors),
      // The overlay snapshot (subscribe with useSyncExternalStore); its
      // `committedRev` tells the view when to invalidate the cache once.
      snapshot: () => store.getState(),
      // The MERGE: the server list with the optimistic overlay laid on top. Plain
      // values, no React, so views never change when the machine behind the seam does.
      items: (serverItems) => __SINGULAR_CAMEL__ItemsOf(store.getState(), serverItems),
      canUndo: () => canUndoOf(store.getState()),
    },
  };
};
