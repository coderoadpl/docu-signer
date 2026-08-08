import { and, assign, getNextSnapshot, setup } from 'xstate';

import {
  buildGuardContext,
  findItem,
  guards,
  PHASES,
  transitionTable,
  type GuardId,
  type Phase,
  type WipLimits,
  type __SINGULAR_PASCAL__Move,
  type __SINGULAR_PASCAL__State,
  type __SINGULAR_PASCAL__Verdict,
} from '__RULES_MODULE__';

/**
 * Machine — the XState oracle DERIVED from the __RULES_PATH__ table. It is NOT
 * hand-written: `buildStates` walks the transition table and emits, for each
 * (from, to) pair, one allow branch guarded by ALL the target's guards plus one
 * reject branch per guard that names the failing rule. Hand-authoring these
 * transitions is forbidden — a hand-written machine drifts from the table (that
 * is exactly what core/rules.drift.test.ts catches).
 *
 * The oracle is CONSULTED, not embedded: this island's own hand-written UI
 * machine calls `evaluate__SINGULAR_PASCAL__Move` in a guard (see the oracle-guard
 * note in core/index.ts); UI states never enter this domain machine.
 */

interface MachineContext {
  readonly itemId: string;
  readonly state: __SINGULAR_PASCAL__State;
  readonly limits: WipLimits;
  readonly verdict: __SINGULAR_PASCAL__Verdict | null;
}

type MachineEvent =
  | { readonly type: 'MOVE_TO_DRAFT' }
  | { readonly type: 'MOVE_TO_ACTIVE' }
  | { readonly type: 'MOVE_TO_DONE' };

const eventByPhase: Readonly<Record<Phase, MachineEvent['type']>> = {
  draft: 'MOVE_TO_DRAFT',
  active: 'MOVE_TO_ACTIVE',
  done: 'MOVE_TO_DONE',
};

const phaseByEvent: Readonly<Record<MachineEvent['type'], Phase>> = {
  MOVE_TO_DRAFT: 'draft',
  MOVE_TO_ACTIVE: 'active',
  MOVE_TO_DONE: 'done',
};

const moveEventByPhase: Readonly<Record<Phase, MachineEvent>> = {
  draft: { type: 'MOVE_TO_DRAFT' },
  active: { type: 'MOVE_TO_ACTIVE' },
  done: { type: 'MOVE_TO_DONE' },
};

const contextCarrier: MachineContext = {
  itemId: '',
  state: { items: [] },
  limits: {},
  verdict: null,
};
// FINDING (as-free carrier): XState's `types` field infers TEvent from the value
// passed, and a single object literal collapses a union to its first member. The
// idiomatic fix is `{} as MachineEvent`, but `as` is banned here — so the carrier
// must be a value whose STATIC type is already the full union. `moveEventByPhase`
// is a `Record<Phase, MachineEvent>`, so indexing it yields `MachineEvent` intact
// (see the b-table spike FINDING comment).
const eventCarrier: MachineEvent = moveEventByPhase.draft;

const guardHolds = (guardId: GuardId, context: MachineContext, event: MachineEvent): boolean => {
  const item = findItem(context.state, context.itemId);
  if (item === undefined) return false;
  const move: __SINGULAR_PASCAL__Move = { itemId: context.itemId, to: phaseByEvent[event.type] };
  return guards[guardId](buildGuardContext(item, move, context.state, context.limits));
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
    markVerdict: assign((_args, params: { readonly verdict: __SINGULAR_PASCAL__Verdict }) => ({
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

const transitionsFor = (from: Phase, to: Phase) => {
  if (to === from) return { target: to, actions: allow };
  const guardIds = transitionTable[to];
  return [
    { target: to, guard: and(guardIds.map(passesRef)), actions: allow },
    ...guardIds.map((guardId) => ({ guard: failsRef(guardId), actions: reject(guardId) })),
  ];
};

const buildStates = () =>
  Object.fromEntries(
    PHASES.map((from) => [
      from,
      { on: Object.fromEntries(PHASES.map((to) => [eventByPhase[to], transitionsFor(from, to)])) },
    ]),
  );

export const __SINGULAR_CAMEL__Machine = factory.createMachine({
  initial: 'draft',
  context: contextCarrier,
  states: buildStates(),
});

/**
 * Evaluate a move against the derived oracle. FAIL-LOUD: if the machine produces
 * NO verdict for a (state, event) pair the table forgot to cover, THROW — never
 * return a permissive default. An unhandled transition is a bug in the table, not
 * an allow.
 */
export const evaluate__SINGULAR_PASCAL__Move = (
  state: __SINGULAR_PASCAL__State,
  move: __SINGULAR_PASCAL__Move,
  limits: WipLimits,
): __SINGULAR_PASCAL__Verdict => {
  const item = findItem(state, move.itemId);
  if (item === undefined) return { allowed: false, rule: 'unknown-item' };
  const snapshot = __SINGULAR_CAMEL__Machine.resolveState({
    value: item.phase,
    context: { itemId: move.itemId, state, limits, verdict: null },
  });
  const next = getNextSnapshot(__SINGULAR_CAMEL__Machine, snapshot, moveEventByPhase[move.to]);
  const { verdict } = next.context;
  if (verdict === null) {
    throw new Error(`machine produced no verdict for ${item.phase} -> ${move.to}`);
  }
  return verdict;
};
