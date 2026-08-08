import { and, assign, getNextSnapshot, setup } from 'xstate';
import { describe, expect, it } from 'vitest';

import {
  canApplyTeamMove,
  guards,
  isTeamColumn,
  TEAM_BOARD_COLUMNS,
  type Card,
  type GuardId,
  type MoveVerdict,
  type RuleId,
  type TeamColumn,
  type TeamMove,
  type WipLimits,
} from '#core/domain/index.js';

import { evaluateTeamMove } from './machine.js';

/**
 * Drift proof (property test, ADR-0005). The DERIVED machine oracle
 * (core/machine.ts, `evaluateTeamMove`) and the server-side table walk
 * (core/domain/team-board.ts, `canApplyTeamMove`) both derive from the SAME
 * transition table, so they must agree on EVERY (column, card-shape, event) pair.
 * This test fails the moment the derivation generator diverges from the table —
 * the isomorphic-rules guarantee. It enumerates the full product INCLUDING the
 * WIP=1 edge, and proves its own detection power with a planted mutant below.
 */

const makeCard = (id: string, column: TeamColumn, visited: readonly string[]): Card => ({
  id,
  tenantId: 't1',
  title: id,
  board: 'team',
  column,
  position: 0,
  visited: [...visited],
  createdAt: '2026-07-19T00:00:00.000Z',
});

// Representative `visited` histories per column: one that has passed through
// 'in-dev' (so review-requires-in-dev can pass) and, where distinct, one that has
// not (so it can fail) — the review guard reads this history.
const visitedReps = (column: TeamColumn): readonly (readonly string[])[] => {
  const withInDev = Array.from(new Set<string>(['in-dev', column]));
  if (column === 'in-dev') return [withInDev];
  return [withInDev, [column]];
};

const boards: readonly (readonly Card[])[] = [
  ...TEAM_BOARD_COLUMNS.flatMap((column) =>
    visitedReps(column).map((visited): readonly Card[] => [makeCard('c1', column, visited)]),
  ),
  ...TEAM_BOARD_COLUMNS.flatMap((occColumn) => {
    const occVisited = visitedReps(occColumn)[0] ?? [occColumn];
    const occupant = makeCard('occ', occColumn, occVisited);
    return TEAM_BOARD_COLUMNS.flatMap((movColumn) =>
      visitedReps(movColumn).map((visited): readonly Card[] => [
        occupant,
        makeCard('c1', movColumn, visited),
      ]),
    );
  }),
];

// {} = no limits; each single-column map saturates that column at capacity 1 (the
// WIP=1 edge the spike learnings call out as omitted by both spike suites).
const limitOptions: readonly WipLimits[] = [{}, { 'in-dev': 1 }, { review: 1 }, { todo: 1 }, { done: 1 }];

const movesFor = (board: readonly Card[]): readonly TeamMove[] => [
  ...board.flatMap((card) =>
    TEAM_BOARD_COLUMNS.map((toColumn): TeamMove => ({ cardId: card.id, toColumn })),
  ),
  { cardId: 'ghost', toColumn: 'done' },
];

interface Scenario {
  readonly board: readonly Card[];
  readonly move: TeamMove;
  readonly limits: WipLimits;
}

const scenarios: readonly Scenario[] = boards.flatMap((board) =>
  limitOptions.flatMap((limits) => movesFor(board).map((move): Scenario => ({ board, move, limits }))),
);

const disagree = (a: MoveVerdict, b: MoveVerdict): boolean => {
  if (a.allowed !== b.allowed) return true;
  return !a.allowed && !b.allowed && a.rule !== b.rule;
};

interface Mismatch {
  readonly scenario: Scenario;
  readonly client: MoveVerdict;
  readonly server: MoveVerdict;
}

const findMismatches = (
  evaluate: (board: readonly Card[], move: TeamMove, limits: WipLimits) => MoveVerdict,
): readonly Mismatch[] =>
  scenarios.flatMap((scenario) => {
    const client = evaluate(scenario.board, scenario.move, scenario.limits);
    const server = canApplyTeamMove(scenario.board, scenario.move, scenario.limits);
    return disagree(client, server) ? [{ scenario, client, server }] : [];
  });

// A deliberately DRIFTED, hand-written machine: it reuses the shared domain guard
// predicates (so the drift is not a logic fork) but every MOVE_TO_REVIEW below is
// wired with the wip guard ONLY, dropping `review-requires-in-dev` — the classic
// "someone forgot to bind a guard" divergence between the two enforcement sites.
interface DriftContext {
  readonly cardId: string;
  readonly board: readonly Card[];
  readonly limits: WipLimits;
  readonly verdict: MoveVerdict | null;
}
type DriftEvent =
  | { readonly type: 'MOVE_TO_TODO' }
  | { readonly type: 'MOVE_TO_IN_DEV' }
  | { readonly type: 'MOVE_TO_REVIEW' }
  | { readonly type: 'MOVE_TO_DONE' };

const driftEventByColumn: Readonly<Record<TeamColumn, DriftEvent>> = {
  todo: { type: 'MOVE_TO_TODO' },
  'in-dev': { type: 'MOVE_TO_IN_DEV' },
  review: { type: 'MOVE_TO_REVIEW' },
  done: { type: 'MOVE_TO_DONE' },
};
const driftColumnByEvent: Readonly<Record<DriftEvent['type'], TeamColumn>> = {
  MOVE_TO_TODO: 'todo',
  MOVE_TO_IN_DEV: 'in-dev',
  MOVE_TO_REVIEW: 'review',
  MOVE_TO_DONE: 'done',
};
const driftCtx: DriftContext = { cardId: '', board: [], limits: {}, verdict: null };

const driftHolds = (guardId: GuardId, context: DriftContext, event: DriftEvent): boolean => {
  const card = context.board.find((candidate) => candidate.id === context.cardId);
  if (card === undefined) return false;
  return guards[guardId]({
    from: card.column,
    to: driftColumnByEvent[event.type],
    card,
    boardCards: context.board,
    limits: context.limits,
  });
};

const driftFactory = setup({
  types: { context: driftCtx, events: driftEventByColumn.todo },
  guards: {
    passes: ({ context, event }, params: { readonly guardId: GuardId }) =>
      driftHolds(params.guardId, context, event),
    fails: ({ context, event }, params: { readonly guardId: GuardId }) =>
      !driftHolds(params.guardId, context, event),
  },
  actions: {
    mark: assign((_a, params: { readonly verdict: MoveVerdict }) => ({ verdict: params.verdict })),
  },
});
// Hand-written INLINE (hoisting these transitions into helper consts widens their
// literal types — `target: string`, `allowed: boolean` — and XState's config type
// rejects them; a second face of the spike's inference friction). The planted
// fault: every MOVE_TO_REVIEW is wired with the wip guard ONLY.
const allow = { type: 'mark' as const, params: { verdict: { allowed: true as const } } };
const wipOk = { type: 'passes' as const, params: { guardId: 'wip-limit' as const } };
const wipNo = {
  guard: { type: 'fails' as const, params: { guardId: 'wip-limit' as const } },
  actions: {
    type: 'mark' as const,
    params: { verdict: { allowed: false as const, rule: 'wip-limit' as const } },
  },
};

const driftedMachine = driftFactory.createMachine({
  initial: 'todo',
  context: driftCtx,
  states: {
    todo: {
      on: {
        MOVE_TO_TODO: { target: 'todo', actions: allow },
        MOVE_TO_IN_DEV: [{ target: 'in-dev', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_REVIEW: [{ target: 'review', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_DONE: [
          { target: 'done', guard: and([{ type: 'passes', params: { guardId: 'done-only-from-review' as const } }, wipOk]), actions: allow },
          { guard: { type: 'fails', params: { guardId: 'done-only-from-review' } }, actions: { type: 'mark', params: { verdict: { allowed: false, rule: 'done-only-from-review' } } } },
          wipNo,
        ],
      },
    },
    'in-dev': {
      on: {
        MOVE_TO_TODO: [{ target: 'todo', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_IN_DEV: { target: 'in-dev', actions: allow },
        MOVE_TO_REVIEW: [{ target: 'review', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_DONE: [
          { target: 'done', guard: and([{ type: 'passes', params: { guardId: 'done-only-from-review' as const } }, wipOk]), actions: allow },
          { guard: { type: 'fails', params: { guardId: 'done-only-from-review' } }, actions: { type: 'mark', params: { verdict: { allowed: false, rule: 'done-only-from-review' } } } },
          wipNo,
        ],
      },
    },
    review: {
      on: {
        MOVE_TO_TODO: [{ target: 'todo', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_IN_DEV: [{ target: 'in-dev', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_REVIEW: { target: 'review', actions: allow },
        MOVE_TO_DONE: [
          { target: 'done', guard: and([{ type: 'passes', params: { guardId: 'done-only-from-review' as const } }, wipOk]), actions: allow },
          { guard: { type: 'fails', params: { guardId: 'done-only-from-review' } }, actions: { type: 'mark', params: { verdict: { allowed: false, rule: 'done-only-from-review' } } } },
          wipNo,
        ],
      },
    },
    done: {
      on: {
        MOVE_TO_TODO: [{ target: 'todo', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_IN_DEV: [{ target: 'in-dev', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_REVIEW: [{ target: 'review', guard: wipOk, actions: allow }, wipNo],
        MOVE_TO_DONE: { target: 'done', actions: allow },
      },
    },
  },
});

const driftedEvaluate = (board: readonly Card[], move: TeamMove, limits: WipLimits): MoveVerdict => {
  const card = board.find((candidate) => candidate.id === move.cardId);
  if (card === undefined) return { allowed: false, rule: 'unknown-card' };
  if (!isTeamColumn(card.column)) throw new Error(`non-team column "${card.column}"`);
  const snapshot = driftedMachine.resolveState({
    value: card.column,
    context: { cardId: move.cardId, board, limits, verdict: null },
  });
  const next = getNextSnapshot(driftedMachine, snapshot, driftEventByColumn[move.toColumn]);
  const { verdict } = next.context;
  if (verdict === null) throw new Error('drifted machine produced no verdict');
  return verdict;
};

describe('team-board rules drift-proof', () => {
  it('derived machine and domain check agree on every (column, card, event) pair', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    expect(findMismatches(evaluateTeamMove)).toEqual([]);
  });

  it('exercises every rejection rule and at least one allowance (non-vacuity)', () => {
    const seenRules = new Set<RuleId>();
    let allowedCount = 0;
    for (const { board, move, limits } of scenarios) {
      const verdict = canApplyTeamMove(board, move, limits);
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

  it('catches drift: the hand-written machine that dropped a guard diverges', () => {
    const mismatches = findMismatches(driftedEvaluate);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(
      mismatches.some(
        (m) => m.scenario.move.toColumn === 'review' && m.client.allowed && !m.server.allowed,
      ),
    ).toBe(true);
  });
});
