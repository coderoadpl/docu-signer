import { TEAM_BOARD_COLUMNS, TEAM_WIP_LIMITS, type Card, type TeamColumn } from '#core/domain/index.js';

import { type TeamBoardEvent } from './events.js';
import {
  columnsOf,
  effectiveBoard,
  occupancyOf,
  pendingIds,
  verdictOf,
  wipLimitOf,
  type TeamColumns,
} from './selectors.js';
import { createTeamBoardStore, type Rejection, type TeamBoardGateway, type TeamOverlayState } from './store.js';

export type { TeamBoardEvent } from './events.js';
export type { TeamCard, TeamColumns } from './selectors.js';
export type { TeamBoardGateway, GatewayResult, Rejection } from './store.js';
export { evaluateTeamMove } from './machine.js';

/**
 * Public seam of the team-board island core: `send` in, selectors out. A view
 * imports ONLY the composed seam (features/team-board/index.web.ts) — never the
 * store, a machine, a descriptor or api.ts — so the rung-3 machinery stays
 * invisible.
 *
 * PORTABLE BY CONSTRUCTION. This module imports no api.ts and no DOM: it is a
 * FACTORY over its dependencies. The web composition injects the real gateway,
 * the bound server-read descriptors and an id source once (index.web.ts); a TUI
 * would inject its own. `descriptors` thread through generically because the core
 * only passes them to `useQuery`/invalidation at the view (typecheck:islands, no
 * DOM). The domain oracle (`evaluateTeamMove`) is pure `core/domain`-derived data,
 * so it stays part of the seam.
 *
 * RUNG 3 (statechart). `send` forwards each intent to the UI store (core/store.ts),
 * which consults the table-derived oracle (core/machine.ts) before dispatching a
 * move to the gateway. The injected `list` descriptor stays the cache truth;
 * `board` merges it with the store's optimistic overlay; `verdict` runs that same
 * board through the oracle so the view can disable illegal moves. The view's calls
 * never change across rungs.
 */
export interface TeamBoardDescriptors<TList, TInvalidates> {
  readonly list: TList;
  readonly invalidates: TInvalidates;
}

export interface TeamBoardCoreDeps<TList, TInvalidates> {
  readonly gateway: TeamBoardGateway;
  readonly descriptors: TeamBoardDescriptors<TList, TInvalidates>;
  readonly generateId: () => string;
}

export interface TeamBoardSelectors<TList, TInvalidates> {
  readonly list: TList;
  readonly invalidates: TInvalidates;
  readonly columns: typeof TEAM_BOARD_COLUMNS;
  readonly limits: typeof TEAM_WIP_LIMITS;
  snapshot(): TeamOverlayState;
  board(serverCards: readonly Card[]): readonly Card[];
  grouped(board: readonly Card[]): TeamColumns;
  verdict(board: readonly Card[], cardId: string, toColumn: TeamColumn): ReturnType<typeof verdictOf>;
  occupancy(board: readonly Card[], column: TeamColumn): number;
  wipLimit(column: TeamColumn): number | undefined;
  lastRejection(): Rejection | null;
}

export interface TeamBoardCore<TList, TInvalidates> {
  send(event: TeamBoardEvent): void;
  subscribe(listener: () => void): () => void;
  readonly teamBoardSelectors: TeamBoardSelectors<TList, TInvalidates>;
}

export const createTeamBoardCore = <TList, TInvalidates>(
  deps: TeamBoardCoreDeps<TList, TInvalidates>,
): TeamBoardCore<TList, TInvalidates> => {
  const store = createTeamBoardStore({ gateway: deps.gateway, generateId: deps.generateId });
  return {
    send: (event) => {
      store.send(event);
    },
    subscribe: (listener) => store.subscribe(listener),
    teamBoardSelectors: {
      list: deps.descriptors.list,
      invalidates: deps.descriptors.invalidates,
      columns: TEAM_BOARD_COLUMNS,
      limits: TEAM_WIP_LIMITS,
      snapshot: () => store.getState(),
      board: (serverCards) => effectiveBoard(store.getState(), serverCards),
      grouped: (board) => columnsOf(board, pendingIds(store.getState())),
      verdict: (board, cardId, toColumn) => verdictOf(board, cardId, toColumn),
      occupancy: (board, column) => occupancyOf(board, column),
      wipLimit: (column) => wipLimitOf(column),
      lastRejection: () => store.getState().lastRejection,
    },
  };
};
