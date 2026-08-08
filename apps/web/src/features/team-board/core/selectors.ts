import {
  TEAM_BOARD_COLUMNS,
  TEAM_WIP_LIMITS,
  type Card,
  type MoveVerdict,
  type TeamColumn,
} from '#core/domain/index.js';

import { evaluateTeamMove } from './machine.js';
import { type TeamOverlayState } from './store.js';

/**
 * Selectors — the read seam of the team-board island (selectors-out), pure TS with
 * no React and no api.ts, so they run in plain node and stay portable.
 *
 * TWO-MACHINES CONTRACT: `effectiveBoard` is the merge point — it takes the
 * card-list truth (TanStack cache) and lays the store's optimistic overlay on top,
 * producing the board the oracle and the view both read. The store keeps no card
 * copy; the cache keeps no interaction state. `verdictOf` runs that board through
 * the SAME table-derived oracle the store consults, so the view's disabled buttons
 * and the store's gate can never disagree.
 */

export interface TeamCard {
  readonly id: string;
  readonly title: string;
  readonly column: TeamColumn;
  /** In-flight optimistic card (added or moved, not yet reconciled with the server). */
  readonly pending: boolean;
}

export type TeamColumns = Record<TeamColumn, readonly TeamCard[]>;

const emptyColumns = (): Record<TeamColumn, TeamCard[]> => ({
  todo: [],
  'in-dev': [],
  review: [],
  done: [],
});

const enter = (visited: readonly string[], column: string): string[] =>
  visited.includes(column) ? [...visited] : [...visited, column];

/**
 * The effective board = server cards with the optimistic overlay applied, as a
 * flat `Card[]` the oracle can evaluate. Optimistic adds are materialised as full
 * cards (the oracle reads only id/column/visited); an optimistic move rewrites the
 * card's column and appends the entered column to `visited` so the oracle sees the
 * same history the server would after committing.
 */
export const effectiveBoard = (
  overlay: TeamOverlayState,
  serverCards: readonly Card[],
): readonly Card[] => {
  const tenantId = serverCards[0]?.tenantId ?? '';
  const cards: Card[] = serverCards.map((card) => ({ ...card }));

  for (const op of overlay.pending) {
    if (op.kind === 'add') {
      cards.push({
        id: op.card.id,
        tenantId,
        title: op.card.title,
        board: 'team',
        column: op.card.column,
        position: cards.filter((card) => card.column === op.card.column).length,
        visited: [op.card.column],
        createdAt: '',
      });
      continue;
    }
    const index = cards.findIndex((card) => card.id === op.cardId);
    const current = cards[index];
    if (current === undefined) continue;
    cards[index] = {
      ...current,
      column: op.toColumn,
      visited: enter(current.visited, op.toColumn),
      position: cards.filter((card) => card.column === op.toColumn && card.id !== op.cardId).length,
    };
  }

  return cards;
};

/** Ids of cards with an in-flight optimistic op — for the `pending` render flag. */
export const pendingIds = (overlay: TeamOverlayState): ReadonlySet<string> => {
  const ids = new Set<string>();
  for (const op of overlay.pending) ids.add(op.kind === 'add' ? op.card.id : op.cardId);
  return ids;
};

/** Group the effective board into its four columns, ordered by server position. */
export const columnsOf = (
  board: readonly Card[],
  pending: ReadonlySet<string>,
): TeamColumns => {
  const columns = emptyColumns();
  for (const column of TEAM_BOARD_COLUMNS) {
    for (const card of board
      .filter((candidate) => candidate.column === column)
      .sort((a, b) => a.position - b.position)) {
      columns[column].push({ id: card.id, title: card.title, column, pending: pending.has(card.id) });
    }
  }
  return columns;
};

export const occupancyOf = (board: readonly Card[], column: TeamColumn): number =>
  board.filter((card) => card.column === column).length;

export const wipLimitOf = (column: TeamColumn): number | undefined => TEAM_WIP_LIMITS[column];

/** The oracle's verdict for one candidate move — the view reads it to gate buttons. */
export const verdictOf = (
  board: readonly Card[],
  cardId: string,
  toColumn: TeamColumn,
): MoveVerdict => evaluateTeamMove(board, { cardId, toColumn }, TEAM_WIP_LIMITS);
