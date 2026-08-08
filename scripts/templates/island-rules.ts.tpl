/**
 * Rules — the transition table AS DATA (__RULES_PATH__) for the __SINGULAR_KEBAB__
 * domain (RUNG 3, ZERO deps). This file is the SINGLE SOURCE OF TRUTH for what
 * moves are legal: core/machine.ts DERIVES an XState oracle from it programmatically
 * (hand-writing that machine is forbidden).
 * __RULES_SERVER_NOTE__
 * core/rules.drift.test.ts fails CI the moment the two disagree on any pair.
 *
 * The Records are typed EXHAUSTIVELY (`Record<Phase, …>`, `Record<GuardId, …>`):
 * the compiler forces a row for every state and a predicate for every guard, so
 * adding a phase or a rule cannot silently skip an enforcement site.
 */

export const PHASES = ['draft', 'active', 'done'] as const;

export type Phase = (typeof PHASES)[number];

export interface __SINGULAR_PASCAL__Item {
  readonly id: string;
  readonly phase: Phase;
}

export interface __SINGULAR_PASCAL__State {
  readonly items: readonly __SINGULAR_PASCAL__Item[];
}

export interface __SINGULAR_PASCAL__Move {
  readonly itemId: string;
  readonly to: Phase;
}

export type WipLimits = Readonly<Partial<Record<Phase, number>>>;

export type RuleId = 'unknown-item' | 'done-requires-active' | 'wip-limit';

// GuardId excludes the pre-table 'unknown-item' verdict: the machine cannot have
// a state for an item that isn't on the board, so it is decided before the table.
export type GuardId = Exclude<RuleId, 'unknown-item'>;

export type __SINGULAR_PASCAL__Verdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: RuleId };

export interface GuardContext {
  readonly from: Phase;
  readonly to: Phase;
  readonly item: __SINGULAR_PASCAL__Item;
  readonly state: __SINGULAR_PASCAL__State;
  readonly limits: WipLimits;
}

export type GuardPredicate = (ctx: GuardContext) => boolean;

// EXHAUSTIVE over GuardId — the compiler forces a predicate for every guard.
export const guards: Readonly<Record<GuardId, GuardPredicate>> = {
  // The example domain guard: `done` is reachable only from `active`. Replace
  // with this island's real ordering rule (add its RuleId to the union above and
  // the compiler will demand a predicate here and a table row below).
  'done-requires-active': ({ from, to }) => to !== 'done' || from === 'active',
  // A standard capacity guard, kept because the drift test exercises its WIP=1
  // edge: a phase with a limit rejects an incoming move once it is full.
  'wip-limit': ({ to, state, item, limits }) => {
    const limit = limits[to];
    if (limit === undefined) return true;
    const occupants = state.items.filter((i) => i.phase === to && i.id !== item.id).length;
    return occupants < limit;
  },
};

// EXHAUSTIVE over Phase — the compiler forces a guard list for every TARGET
// phase. Order matters: the FIRST failing guard names the verdict's rule.
export const transitionTable: Readonly<Record<Phase, readonly GuardId[]>> = {
  draft: ['wip-limit'],
  active: ['wip-limit'],
  done: ['done-requires-active', 'wip-limit'],
};

export const findItem = (
  state: __SINGULAR_PASCAL__State,
  itemId: string,
): __SINGULAR_PASCAL__Item | undefined => state.items.find((item) => item.id === itemId);

export const buildGuardContext = (
  item: __SINGULAR_PASCAL__Item,
  move: __SINGULAR_PASCAL__Move,
  state: __SINGULAR_PASCAL__State,
  limits: WipLimits,
): GuardContext => ({ from: item.phase, to: move.to, item, state, limits });

/**
 * __RULES_SERVER_REF__
 */
export const canApply__SINGULAR_PASCAL__Move = (
  state: __SINGULAR_PASCAL__State,
  move: __SINGULAR_PASCAL__Move,
  limits: WipLimits,
): __SINGULAR_PASCAL__Verdict => {
  const item = findItem(state, move.itemId);
  if (item === undefined) return { allowed: false, rule: 'unknown-item' };
  if (item.phase === move.to) return { allowed: true };
  const ctx = buildGuardContext(item, move, state, limits);
  for (const guardId of transitionTable[move.to]) {
    if (!guards[guardId](ctx)) return { allowed: false, rule: guardId };
  }
  return { allowed: true };
};
