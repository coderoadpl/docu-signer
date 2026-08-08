import { describe, expect, it } from 'vitest';

import type { Card } from './card.js';
import {
  canApplyTeamMove,
  guards,
  TEAM_BOARD_COLUMNS,
  transitionTable,
  type GuardId,
  type MoveVerdict,
  type RuleId,
  type TeamColumn,
  type TeamMove,
  type WipLimits,
} from './team-board.js';

const teamCard = (
  id: string,
  column: TeamColumn,
  visited: readonly TeamColumn[] = [column],
): Card => ({
  id,
  tenantId: 't-acme',
  title: id,
  board: 'team',
  column,
  position: 0,
  visited: [...visited],
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('team-board guards', () => {
  it('done-only-from-review: done is reachable only from review', () => {
    const board = [teamCard('c1', 'in-dev', ['todo', 'in-dev'])];
    expect(canApplyTeamMove(board, { cardId: 'c1', toColumn: 'done' }, {})).toEqual({
      allowed: false,
      rule: 'done-only-from-review',
    });
    const fromReview = [teamCard('c1', 'review', ['todo', 'in-dev', 'review'])];
    expect(canApplyTeamMove(fromReview, { cardId: 'c1', toColumn: 'done' }, {})).toEqual({
      allowed: true,
    });
  });

  it('review-requires-in-dev: review needs in-dev in the card history', () => {
    const neverInDev = [teamCard('c1', 'todo', ['todo'])];
    expect(canApplyTeamMove(neverInDev, { cardId: 'c1', toColumn: 'review' }, {})).toEqual({
      allowed: false,
      rule: 'review-requires-in-dev',
    });
    const visitedInDev = [teamCard('c1', 'todo', ['todo', 'in-dev'])];
    expect(canApplyTeamMove(visitedInDev, { cardId: 'c1', toColumn: 'review' }, {})).toEqual({
      allowed: true,
    });
  });

  it('wip-limit: a full destination column blocks the move', () => {
    const board = [
      teamCard('occ1', 'in-dev', ['todo', 'in-dev']),
      teamCard('occ2', 'in-dev', ['todo', 'in-dev']),
      teamCard('c1', 'todo', ['todo']),
    ];
    expect(canApplyTeamMove(board, { cardId: 'c1', toColumn: 'in-dev' }, { 'in-dev': 2 })).toEqual({
      allowed: false,
      rule: 'wip-limit',
    });
    expect(canApplyTeamMove(board, { cardId: 'c1', toColumn: 'in-dev' }, { 'in-dev': 3 })).toEqual({
      allowed: true,
    });
  });

  it('wip-limit WIP=1 edge: one occupant fills a limit-1 column', () => {
    const full = [teamCard('occ', 'in-dev', ['todo', 'in-dev']), teamCard('c1', 'todo', ['todo'])];
    expect(canApplyTeamMove(full, { cardId: 'c1', toColumn: 'in-dev' }, { 'in-dev': 1 })).toEqual({
      allowed: false,
      rule: 'wip-limit',
    });
    // The moving card is excluded from its own destination count: an empty
    // limit-1 column admits exactly one card.
    const empty = [teamCard('c1', 'todo', ['todo'])];
    expect(canApplyTeamMove(empty, { cardId: 'c1', toColumn: 'in-dev' }, { 'in-dev': 1 })).toEqual({
      allowed: true,
    });
  });
});

describe('canApplyTeamMove', () => {
  it('walks the legal path todo -> in-dev -> review -> done', () => {
    let card = teamCard('c1', 'todo', ['todo']);
    const step = (toColumn: TeamColumn): void => {
      const verdict = canApplyTeamMove([card], { cardId: 'c1', toColumn }, {});
      expect(verdict).toEqual({ allowed: true });
      card = { ...card, column: toColumn, visited: [...card.visited, toColumn] };
    };
    step('in-dev');
    step('review');
    step('done');
  });

  it('treats a same-column move as a legal no-op reorder', () => {
    const board = [teamCard('c1', 'review', ['todo', 'in-dev', 'review'])];
    expect(canApplyTeamMove(board, { cardId: 'c1', toColumn: 'review' }, { review: 1 })).toEqual({
      allowed: true,
    });
  });

  it('rejects a move on a card that is not on the board', () => {
    expect(canApplyTeamMove([], { cardId: 'ghost', toColumn: 'done' }, {})).toEqual({
      allowed: false,
      rule: 'unknown-card',
    });
  });
});

// A DRIFTED, hand-wired server check reusing the shared guard predicates, but
// with the review transition wired WITHOUT `review-requires-in-dev` — the
// classic "someone forgot to bind a guard" divergence between enforcement
// sites. The property sweep below must catch it, proving its detection power
// (ADR-0005: a drift test must demonstrate detection with a planted mutant).
const driftedTransitionTable: Readonly<Record<TeamColumn, readonly GuardId[]>> = {
  ...transitionTable,
  review: ['wip-limit'],
};

const driftedCheck = (
  boardCards: readonly Card[],
  move: TeamMove,
  limits: WipLimits,
): MoveVerdict => {
  const card = boardCards.find((c) => c.id === move.cardId);
  if (card === undefined) return { allowed: false, rule: 'unknown-card' };
  if (card.column === move.toColumn) return { allowed: true };
  for (const guardId of driftedTransitionTable[move.toColumn]) {
    if (!guards[guardId]({ from: card.column, to: move.toColumn, card, boardCards, limits })) {
      return { allowed: false, rule: guardId };
    }
  }
  return { allowed: true };
};

const visitedReps = (col: TeamColumn): readonly (readonly TeamColumn[])[] => {
  const withInDev: readonly TeamColumn[] = [...new Set<TeamColumn>(['in-dev', col])];
  return col === 'in-dev' ? [withInDev] : [withInDev, [col]];
};

interface Scenario {
  readonly boardCards: readonly Card[];
  readonly move: TeamMove;
  readonly limits: WipLimits;
}

// WIP=1 edge limits are included deliberately (ADR-0005: both spike suites
// omitted {todo:1}/{done:1}).
const limitOptions: readonly WipLimits[] = [
  {},
  { 'in-dev': 1 },
  { review: 1 },
  { todo: 1 },
  { done: 1 },
  { 'in-dev': 3, review: 2 },
];

const scenarios: readonly Scenario[] = TEAM_BOARD_COLUMNS.flatMap((occCol) => {
  const occupant = teamCard('occ', occCol, visitedReps(occCol)[0]);
  return TEAM_BOARD_COLUMNS.flatMap((movCol) =>
    visitedReps(movCol).flatMap((visited) => {
      const boardCards = [occupant, teamCard('c1', movCol, visited)];
      return limitOptions.flatMap((limits) =>
        [...TEAM_BOARD_COLUMNS.map((toColumn): TeamMove => ({ cardId: 'c1', toColumn })), { cardId: 'ghost', toColumn: 'done' } as const].map(
          (move): Scenario => ({ boardCards, move, limits }),
        ),
      );
    }),
  );
});

const verdictsDiffer = (a: MoveVerdict, b: MoveVerdict): boolean => {
  if (a.allowed !== b.allowed) return true;
  return !a.allowed && !b.allowed && a.rule !== b.rule;
};

describe('team-board drift property sweep', () => {
  it('exercises every rejection rule and at least one allowance (non-vacuity)', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    const seenRules = new Set<RuleId>();
    let allowedCount = 0;
    for (const { boardCards, move, limits } of scenarios) {
      const verdict = canApplyTeamMove(boardCards, move, limits);
      if (verdict.allowed) allowedCount += 1;
      else seenRules.add(verdict.rule);
    }
    const required: readonly RuleId[] = [
      'unknown-card',
      'done-only-from-review',
      'review-requires-in-dev',
      'wip-limit',
    ];
    for (const rule of required) expect(seenRules.has(rule)).toBe(true);
    expect(allowedCount).toBeGreaterThan(0);
  });

  it('catches the planted mutant: a check that drops a guard diverges', () => {
    const mismatches = scenarios.filter(({ boardCards, move, limits }) =>
      verdictsDiffer(
        canApplyTeamMove(boardCards, move, limits),
        driftedCheck(boardCards, move, limits),
      ),
    );
    expect(mismatches.length).toBeGreaterThan(0);
    // The specific drift: a review move the correct check rejects, the mutant admits.
    expect(
      mismatches.some(({ boardCards, move, limits }) => {
        const correct = canApplyTeamMove(boardCards, move, limits);
        const drifted = driftedCheck(boardCards, move, limits);
        return move.toColumn === 'review' && !correct.allowed && drifted.allowed;
      }),
    ).toBe(true);
  });
});
