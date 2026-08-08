import {
  canApplyTeamMove,
  cardListQuerySchema,
  cardMoveSchema,
  err,
  isPersonalColumn,
  isTeamColumn,
  newCardSchema,
  notFound,
  ok,
  TEAM_BOARD_ENTRY_COLUMN,
  TEAM_WIP_LIMITS,
  validation,
  type AppError,
  type BoardId,
  type Card,
  type CardListQuery,
  type CardMove,
  type NewCard,
  type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { CardPositionUpdate, CardRepository, Clock, IdGenerator } from '../ports.js';

export interface CardDeps {
  cards: CardRepository;
  ids: IdGenerator;
  clock: Clock;
}

const byPosition = (a: Card, b: Card): number => a.position - b.position;

/** Which column set governs a board — the domain fact each board enforces. */
const isColumnOfBoard = (board: BoardId, column: string): boolean =>
  board === 'team' ? isTeamColumn(column) : isPersonalColumn(column);

/** Append the entered column to a card's history, de-duplicated and order-preserving. */
const enter = (visited: readonly string[], column: string): string[] =>
  visited.includes(column) ? [...visited] : [...visited, column];

export const listCards = async (
  ctx: Ctx,
  input: CardListQuery,
  deps: CardDeps,
): Promise<Result<Card[], AppError>> => {
  const scope = authorizeTenant(ctx, 'card:read');
  if (!scope.ok) return scope;
  const parsed = cardListQuerySchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid card query', parsed.error.flatten()));
  return ok(await deps.cards.listByTenant(scope.value, parsed.data.board));
};

export const addCard = async (
  ctx: Ctx,
  input: NewCard,
  deps: CardDeps,
): Promise<Result<Card, AppError>> => {
  const scope = authorizeTenant(ctx, 'card:write');
  if (!scope.ok) return scope;

  const parsed = newCardSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid card', parsed.error.flatten()));
  const { board, column, title } = parsed.data;
  if (!isColumnOfBoard(board, column)) {
    return err(validation(`Unknown column "${column}" for the ${board} board`));
  }
  if (board === 'team' && column !== TEAM_BOARD_ENTRY_COLUMN) {
    return err(
      validation(
        `Team cards start in "${TEAM_BOARD_ENTRY_COLUMN}" — creating one in "${column}" would bypass the path guards`,
        { rule: 'entry-column' },
      ),
    );
  }

  const existing = await deps.cards.listByTenant(scope.value, board);
  const position = existing.filter((card) => card.column === column).length;

  const card: Card = {
    id: deps.ids.nextId(),
    tenantId: scope.value,
    title,
    board,
    column,
    position,
    // A new card's history starts with the column it was created in — the team
    // board's review-requires-in-dev guard reads this; inert for personal.
    visited: [column],
    createdAt: deps.clock.nowIso(),
  };
  await deps.cards.create(card);
  return ok(card);
};

/**
 * Movement is board-aware. The team board consults `canApplyTeamMove` (derived
 * from the `core/domain` transition table) BEFORE persisting — a rejected move
 * returns a `validation` error naming the offending rule (→ HTTP 400 → CLI exit
 * 2) and touches nothing. The personal board keeps free movement.
 *
 * On success the entered column is appended to the moving card's `visited`
 * history, and positions are rewritten as contiguous 0-based indices. `toIndex`
 * is clamped into range HERE, before persistence (ADR-0005 spike-learning:
 * clamp raw payload indices at the gateway, never trust the client's optimistic
 * index), so persisted order can never diverge.
 */
export const moveCard = async (
  ctx: Ctx,
  input: CardMove,
  deps: CardDeps,
): Promise<Result<Card, AppError>> => {
  const scope = authorizeTenant(ctx, 'card:write');
  if (!scope.ok) return scope;

  const parsed = cardMoveSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid move', parsed.error.flatten()));
  const { cardId, board, toColumn, toIndex } = parsed.data;

  const tenantId = scope.value;
  const all = await deps.cards.listByTenant(tenantId, board);
  const moving = all.find((card) => card.id === cardId);
  if (!moving) return err(notFound(`Card ${cardId} not found`));

  if (board === 'team') {
    // `isTeamColumn` narrows `toColumn` to a `TeamColumn` so the check derives
    // from the same transition table the island machine derives from — no cast.
    if (!isTeamColumn(toColumn)) {
      return err(validation(`Unknown column "${toColumn}" for the team board`));
    }
    const verdict = canApplyTeamMove(all, { cardId, toColumn }, TEAM_WIP_LIMITS);
    if (!verdict.allowed) {
      return err(validation(`Move blocked by rule "${verdict.rule}"`, { rule: verdict.rule }));
    }
  } else if (!isPersonalColumn(toColumn)) {
    return err(validation(`Unknown column "${toColumn}" for the personal board`));
  }

  const target = all
    .filter((card) => card.column === toColumn && card.id !== cardId)
    .sort(byPosition);
  const clampedIndex = Math.max(0, Math.min(toIndex, target.length));
  const nextVisited = enter(moving.visited, toColumn);
  const moved: Card = { ...moving, column: toColumn, position: clampedIndex, visited: nextVisited };
  target.splice(clampedIndex, 0, moved);

  const updates: CardPositionUpdate[] = target.map((card, index) => ({
    id: card.id,
    column: toColumn,
    position: index,
    // Only the moving card's history changed; carry it just for that row.
    ...(card.id === cardId ? { visited: nextVisited } : {}),
  }));

  if (moving.column !== toColumn) {
    all
      .filter((card) => card.column === moving.column && card.id !== cardId)
      .sort(byPosition)
      .forEach((card, index) => {
        updates.push({ id: card.id, column: moving.column, position: index });
      });
  }

  await deps.cards.updatePositions(tenantId, board, updates);
  return ok(moved);
};
