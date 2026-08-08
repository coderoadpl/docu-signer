import { z } from 'zod';

import type { Card } from './card.js';

/**
 * The team board's domain rules — the single source both enforcement sites
 * derive from (ADR-0005 §Isomorphic domain rules). It lives in `core/domain`
 * (zod only, zero new deps) because transition legality is a *business* rule:
 * client-only enforcement is cosmetics a CLI request walks straight past.
 *
 * Shape: the transition table as plain data (allowed moves + guard predicates).
 * The server use-case derives a pure check from it (`canApplyTeamMove` below);
 * the team-board island derives its XState machine from the same table
 * (hand-writing that machine is forbidden). A CI drift property test proves the
 * two derivations agree — this file is the half both import.
 */

export const TEAM_BOARD_COLUMNS = ['todo', 'in-dev', 'review', 'done'] as const;

export type TeamColumn = (typeof TEAM_BOARD_COLUMNS)[number];

export const teamColumnSchema = z.enum(TEAM_BOARD_COLUMNS);

export const isTeamColumn = (value: string): value is TeamColumn =>
  TEAM_BOARD_COLUMNS.some((column) => column === value);

// Team cards are born at the start of the flow: creating a card directly in a
// later column would bypass every path guard below (a card spawned in `done`
// never visited `in-dev`), so the entry column is a rule, not a default.
export const TEAM_BOARD_ENTRY_COLUMN: TeamColumn = 'todo';

/** WIP limits as data: a column absent from the map is unbounded. */
export type WipLimits = Readonly<Partial<Record<TeamColumn, number>>>;

/** The demo's limits; the foundation prescribes the mechanism, the app the numbers. */
export const TEAM_WIP_LIMITS: WipLimits = { 'in-dev': 3, review: 2 };

/** A move on the team board: which card, to which column. */
export interface TeamMove {
  readonly cardId: string;
  readonly toColumn: TeamColumn;
}

/** Every guard the table can name — one id per business rule. */
export type GuardId = 'wip-limit' | 'done-only-from-review' | 'review-requires-in-dev';

/** A verdict's rule id: a guard, or `unknown-card` for a move on a missing card. */
export type RuleId = GuardId | 'unknown-card';

export type MoveVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: RuleId };

interface GuardContext {
  readonly from: string;
  readonly to: TeamColumn;
  readonly card: Card;
  readonly boardCards: readonly Card[];
  readonly limits: WipLimits;
}

type GuardPredicate = (ctx: GuardContext) => boolean;

/**
 * The guard predicates, keyed by id. Pure, board-scoped, and read only the real
 * `Card` shape (`column`, `visited`, `id`) so both sites share one implementation.
 */
export const guards: Readonly<Record<GuardId, GuardPredicate>> = {
  'done-only-from-review': ({ from, to }) => to !== 'done' || from === 'review',
  'review-requires-in-dev': ({ to, card }) => to !== 'review' || card.visited.includes('in-dev'),
  'wip-limit': ({ to, boardCards, card, limits }) => {
    const limit = limits[to];
    if (limit === undefined) return true;
    const occupants = boardCards.filter((c) => c.column === to && c.id !== card.id).length;
    return occupants < limit;
  },
};

/**
 * The exhaustive transition table: for every destination column, the guards a
 * move INTO it must pass. Exhaustive over `TeamColumn` by type — extending the
 * column union is a compile error until this `Record` is extended too.
 */
export const transitionTable: Readonly<Record<TeamColumn, readonly GuardId[]>> = {
  todo: ['wip-limit'],
  'in-dev': ['wip-limit'],
  review: ['review-requires-in-dev', 'wip-limit'],
  done: ['done-only-from-review', 'wip-limit'],
};

/**
 * The server-side derived check: one transition of the table, fail-loud by
 * construction (every branch returns a verdict — no permissive default is ever
 * seeded, the fail-open hazard that sank the shared-machine alternative). A
 * same-column move is a no-op reorder and always legal; an unknown card yields
 * `unknown-card`; otherwise every guard the table names for the destination is
 * evaluated and the first failure names the rejected verdict's rule.
 */
export const canApplyTeamMove = (
  boardCards: readonly Card[],
  move: TeamMove,
  limits: WipLimits,
): MoveVerdict => {
  const card = boardCards.find((c) => c.id === move.cardId);
  if (card === undefined) return { allowed: false, rule: 'unknown-card' };
  if (card.column === move.toColumn) return { allowed: true };

  const ctx: GuardContext = {
    from: card.column,
    to: move.toColumn,
    card,
    boardCards,
    limits,
  };
  for (const guardId of transitionTable[move.toColumn]) {
    if (!guards[guardId](ctx)) return { allowed: false, rule: guardId };
  }
  return { allowed: true };
};
