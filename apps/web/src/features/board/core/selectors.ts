import {
  isPersonalColumn,
  PERSONAL_BOARD_COLUMNS,
  type Card,
  type PersonalColumn,
} from '#core/domain/index.js';

import { type BoardOverlayState } from './store.js';

/**
 * Selectors — the read seam of the board island (selectors-out), pure TS with no
 * React and no api.ts, so they run in plain node and stay portable.
 *
 * TWO-MACHINES CONTRACT: `boardOf` is the merge point — it takes the card-list
 * truth (TanStack cache) and lays the store's optimistic overlay on top. The
 * store keeps no card copy; the cache keeps no interaction state.
 */

export interface BoardCard {
  readonly id: string;
  readonly title: string;
  readonly column: PersonalColumn;
  /** In-flight optimistic card (added or moved, not yet reconciled with the server). */
  readonly pending: boolean;
}

export type BoardColumns = Record<PersonalColumn, readonly BoardCard[]>;

const emptyColumns = (): Record<PersonalColumn, BoardCard[]> => {
  const columns: Record<PersonalColumn, BoardCard[]> = { todo: [], doing: [], done: [] };
  return columns;
};

const insertAt = (
  cards: BoardCard[],
  card: BoardCard,
  index: number,
): void => {
  const clamped = Math.max(0, Math.min(index, cards.length));
  cards.splice(clamped, 0, card);
};

const takeById = (
  columns: Record<PersonalColumn, BoardCard[]>,
  cardId: string,
): BoardCard | undefined => {
  for (const column of PERSONAL_BOARD_COLUMNS) {
    const cards = columns[column];
    const index = cards.findIndex((card) => card.id === cardId);
    if (index !== -1) return cards.splice(index, 1)[0];
  }
  return undefined;
};

export const boardOf = (state: BoardOverlayState, serverCards: readonly Card[]): BoardColumns => {
  const columns = emptyColumns();

  for (const column of PERSONAL_BOARD_COLUMNS) {
    for (const card of serverCards
      .filter((candidate) => candidate.column === column)
      .sort((a, b) => a.position - b.position)) {
      columns[column].push({ id: card.id, title: card.title, column, pending: false });
    }
  }

  for (const op of state.pending) {
    if (op.kind === 'add') {
      if (isPersonalColumn(op.card.column)) {
        columns[op.card.column].push({
          id: op.card.id,
          title: op.card.title,
          column: op.card.column,
          pending: true,
        });
      }
      continue;
    }
    if (!isPersonalColumn(op.toColumn)) continue;
    const card = takeById(columns, op.cardId);
    if (card === undefined) continue;
    insertAt(columns[op.toColumn], { ...card, column: op.toColumn, pending: true }, op.toIndex);
  }

  return columns;
};

export const canUndoOf = (state: BoardOverlayState): boolean => state.undo !== null;
