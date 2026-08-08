import { and, assign, getNextSnapshot, setup } from 'xstate';

import {
  guards,
  isTeamColumn,
  TEAM_BOARD_COLUMNS,
  transitionTable,
  type Card,
  type GuardId,
  type MoveVerdict,
  type TeamColumn,
  type TeamMove,
  type WipLimits,
} from '#core/domain/index.js';

/**
 * Machine — the XState oracle DERIVED from the `core/domain` team-board transition
 * table (ADR-0005). The rules are NOT redefined here: `guards`, `transitionTable`
 * and the column set are imported from `core/domain/team-board.ts`, the single
 * source both the server check (`canApplyTeamMove`) and this machine share. This
 * file only turns that data into a statechart: `buildStates` walks the table and
 * emits, for each (from, to) pair, one allow branch guarded by ALL the target's
 * guards plus one reject branch per guard that names the failing rule.
 * Hand-authoring these transitions is forbidden — a hand-written machine drifts
 * from the table, which is exactly what core/rules.drift.test.ts catches.
 *
 * The oracle is CONSULTED, not embedded: this island's UI store (core/store.ts)
 * calls `evaluateTeamMove` before dispatching a move, and the view calls it to
 * disable illegal moves. UI states (pending, optimism) never enter this machine.
 */

interface MachineContext {
  readonly cardId: string;
  readonly board: readonly Card[];
  readonly limits: WipLimits;
  readonly verdict: MoveVerdict | null;
}

type MachineEvent =
  | { readonly type: 'MOVE_TO_TODO' }
  | { readonly type: 'MOVE_TO_IN_DEV' }
  | { readonly type: 'MOVE_TO_REVIEW' }
  | { readonly type: 'MOVE_TO_DONE' };

const eventByColumn: Readonly<Record<TeamColumn, MachineEvent['type']>> = {
  todo: 'MOVE_TO_TODO',
  'in-dev': 'MOVE_TO_IN_DEV',
  review: 'MOVE_TO_REVIEW',
  done: 'MOVE_TO_DONE',
};

const columnByEvent: Readonly<Record<MachineEvent['type'], TeamColumn>> = {
  MOVE_TO_TODO: 'todo',
  MOVE_TO_IN_DEV: 'in-dev',
  MOVE_TO_REVIEW: 'review',
  MOVE_TO_DONE: 'done',
};

const moveEventByColumn: Readonly<Record<TeamColumn, MachineEvent>> = {
  todo: { type: 'MOVE_TO_TODO' },
  'in-dev': { type: 'MOVE_TO_IN_DEV' },
  review: { type: 'MOVE_TO_REVIEW' },
  done: { type: 'MOVE_TO_DONE' },
};

const contextCarrier: MachineContext = {
  cardId: '',
  board: [],
  limits: {},
  verdict: null,
};
// FINDING (as-free carrier): XState's `types` field infers TEvent from the value
// passed, and a single object literal collapses a union to its first member. The
// idiomatic fix is `{} as MachineEvent`, but `as` is banned here — so the carrier
// must be a value whose STATIC type is already the full union. `moveEventByColumn`
// is a `Record<TeamColumn, MachineEvent>`, so indexing it yields `MachineEvent`
// intact (see the b-table spike FINDING comment).
const eventCarrier: MachineEvent = moveEventByColumn.todo;

const guardHolds = (guardId: GuardId, context: MachineContext, event: MachineEvent): boolean => {
  const card = context.board.find((candidate) => candidate.id === context.cardId);
  if (card === undefined) return false;
  return guards[guardId]({
    from: card.column,
    to: columnByEvent[event.type],
    card,
    boardCards: context.board,
    limits: context.limits,
  });
};

const factory = setup({
  types: { context: contextCarrier, events: eventCarrier },
  guards: {
    guardPasses: ({ context, event }, params: { readonly guardId: GuardId }) =>
      guardHolds(params.guardId, context, event),
    guardFails: ({ context, event }, params: { readonly guardId: GuardId }) =>
      !guardHolds(params.guardId, context, event),
  },
  actions: {
    markVerdict: assign((_args, params: { readonly verdict: MoveVerdict }) => ({
      verdict: params.verdict,
    })),
  },
});

const allow = { type: 'markVerdict' as const, params: { verdict: { allowed: true } } };
const reject = (rule: GuardId) => ({
  type: 'markVerdict' as const,
  params: { verdict: { allowed: false, rule } },
});
const passesRef = (guardId: GuardId) => ({ type: 'guardPasses' as const, params: { guardId } });
const failsRef = (guardId: GuardId) => ({ type: 'guardFails' as const, params: { guardId } });

const transitionsFor = (from: TeamColumn, to: TeamColumn) => {
  if (to === from) return { target: to, actions: allow };
  const guardIds = transitionTable[to];
  return [
    { target: to, guard: and(guardIds.map(passesRef)), actions: allow },
    ...guardIds.map((guardId) => ({ guard: failsRef(guardId), actions: reject(guardId) })),
  ];
};

const buildStates = () =>
  Object.fromEntries(
    TEAM_BOARD_COLUMNS.map((from) => [
      from,
      {
        on: Object.fromEntries(
          TEAM_BOARD_COLUMNS.map((to) => [eventByColumn[to], transitionsFor(from, to)]),
        ),
      },
    ]),
  );

export const teamBoardMachine = factory.createMachine({
  initial: 'todo',
  context: contextCarrier,
  states: buildStates(),
});

/**
 * Evaluate one move against the derived oracle. FAIL-LOUD (ADR-0005 spike
 * learning): if the machine produces NO verdict for a pair the table forgot to
 * cover, THROW — never seed a permissive default, the fail-open hazard that sank
 * the shared-machine alternative. An unknown card is decided before the table
 * (there is no machine state for a card not on the board); a `from` column that
 * is not a team column is a bug in the board's contents and throws.
 */
export const evaluateTeamMove = (
  board: readonly Card[],
  move: TeamMove,
  limits: WipLimits,
): MoveVerdict => {
  const card = board.find((candidate) => candidate.id === move.cardId);
  if (card === undefined) return { allowed: false, rule: 'unknown-card' };
  if (!isTeamColumn(card.column)) {
    throw new Error(`card ${card.id} sits in non-team column "${card.column}"`);
  }
  const snapshot = teamBoardMachine.resolveState({
    value: card.column,
    context: { cardId: move.cardId, board, limits, verdict: null },
  });
  const next = getNextSnapshot(teamBoardMachine, snapshot, moveEventByColumn[move.toColumn]);
  const { verdict } = next.context;
  if (verdict === null) {
    throw new Error(`machine produced no verdict for ${card.column} -> ${move.toColumn}`);
  }
  return verdict;
};
