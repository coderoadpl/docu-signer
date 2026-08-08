import { PERSONAL_BOARD_COLUMNS, type Card } from '#core/domain/index.js';

import { type BoardEvent } from './events.js';
import { boardOf, canUndoOf, type BoardColumns } from './selectors.js';
import { createBoardStore, type BoardGateway, type BoardOverlayState } from './store.js';

export type { BoardEvent } from './events.js';
export type { BoardCard, BoardColumns } from './selectors.js';
export type { BoardGateway, GatewayResult } from './store.js';

/**
 * Public seam of the board island core: `send` in, selectors out. A view imports
 * ONLY the composed seam (features/board/index.web.ts) — never the store, a
 * descriptor or api.ts — so the machine behind the seam stays invisible and
 * swappable.
 *
 * PORTABLE BY CONSTRUCTION. This module imports no api.ts and no DOM: it is a
 * FACTORY over its dependencies. The web composition injects the real gateway,
 * the bound server-read descriptors and an id source once (index.web.ts); a TUI
 * would inject its own. `descriptors` are threaded generically because the core
 * only passes them through to `useQuery`/invalidation at the view — it never
 * looks inside them, so it needs no api/query types (typecheck:islands, no DOM).
 *
 * RUNG 2 (island store). `send` forwards each event to the @xstate/store store
 * (core/store.ts). The injected `list` descriptor stays the cache truth; `board`
 * merges it with the store's optimistic overlay; `invalidates` lets the view
 * refetch the truth once a persist commits. The view's calls never change across
 * rungs.
 */
export interface BoardDescriptors<TList, TInvalidates> {
  readonly list: TList;
  readonly invalidates: TInvalidates;
}

export interface BoardCoreDeps<TList, TInvalidates> {
  readonly gateway: BoardGateway;
  readonly descriptors: BoardDescriptors<TList, TInvalidates>;
  readonly generateId: () => string;
}

export interface BoardSelectors<TList, TInvalidates> {
  readonly list: TList;
  readonly invalidates: TInvalidates;
  readonly columns: typeof PERSONAL_BOARD_COLUMNS;
  snapshot(): BoardOverlayState;
  board(serverCards: readonly Card[]): BoardColumns;
  canUndo(): boolean;
}

export interface BoardCore<TList, TInvalidates> {
  send(event: BoardEvent): void;
  subscribe(listener: () => void): () => void;
  readonly boardSelectors: BoardSelectors<TList, TInvalidates>;
}

export const createBoardCore = <TList, TInvalidates>(
  deps: BoardCoreDeps<TList, TInvalidates>,
): BoardCore<TList, TInvalidates> => {
  const store = createBoardStore({ gateway: deps.gateway, generateId: deps.generateId });
  return {
    send: (event) => {
      store.send(event);
    },
    subscribe: (listener) => store.subscribe(listener),
    boardSelectors: {
      list: deps.descriptors.list,
      invalidates: deps.descriptors.invalidates,
      columns: PERSONAL_BOARD_COLUMNS,
      snapshot: () => store.getState(),
      board: (serverCards) => boardOf(store.getState(), serverCards),
      canUndo: () => canUndoOf(store.getState()),
    },
  };
};
