import { describe, expect, it } from 'vitest';

import { evaluate__SINGULAR_PASCAL__Move } from './machine.js';
import {
  canApply__SINGULAR_PASCAL__Move,
  PHASES,
  type RuleId,
  type WipLimits,
  type __SINGULAR_PASCAL__Move,
  type __SINGULAR_PASCAL__State,
  type __SINGULAR_PASCAL__Verdict,
} from '__RULES_MODULE__';

/**
 * Drift proof (property test): the DERIVED machine oracle (core/machine.ts) and
 * the direct table walk (__RULES_PATH__) both derive from the SAME transition
 * table, so they must agree on EVERY (state, event) pair. This test fails CI the
 * moment the derivation generator diverges from the table — the isomorphic-rules
 * guarantee. It enumerates the full product, INCLUDING the WIP=1 edge.
 */

interface Scenario {
  readonly state: __SINGULAR_PASCAL__State;
  readonly move: __SINGULAR_PASCAL__Move;
  readonly limits: WipLimits;
}

const singleItemStates: readonly __SINGULAR_PASCAL__State[] = PHASES.map((phase) => ({
  items: [{ id: 'a', phase }],
}));

// A second occupant so the WIP=1 edge is reachable: the target phase can be full.
const occupiedStates: readonly __SINGULAR_PASCAL__State[] = PHASES.flatMap((occ) =>
  PHASES.map((phase): __SINGULAR_PASCAL__State => ({
    items: [
      { id: 'occ', phase: occ },
      { id: 'a', phase },
    ],
  })),
);

const states: readonly __SINGULAR_PASCAL__State[] = [...singleItemStates, ...occupiedStates];

// {} = no limits; each single-phase map makes that phase saturate at capacity 1
// (the WIP=1 edge the spike learnings call out).
const limitOptions: readonly WipLimits[] = [{}, ...PHASES.map((phase): WipLimits => ({ [phase]: 1 }))];

const movesFor = (state: __SINGULAR_PASCAL__State): readonly __SINGULAR_PASCAL__Move[] => [
  ...state.items.flatMap((item) => PHASES.map((to): __SINGULAR_PASCAL__Move => ({ itemId: item.id, to }))),
  // A ghost item exercises the pre-table 'unknown-item' verdict.
  { itemId: 'ghost', to: 'done' },
];

const scenarios: readonly Scenario[] = states.flatMap((state) =>
  limitOptions.flatMap((limits) => movesFor(state).map((move): Scenario => ({ state, move, limits }))),
);

const disagree = (a: __SINGULAR_PASCAL__Verdict, b: __SINGULAR_PASCAL__Verdict): boolean => {
  if (a.allowed !== b.allowed) return true;
  return !a.allowed && !b.allowed && a.rule !== b.rule;
};

describe('__SINGULAR_KEBAB__ rules drift-proof', () => {
  it('derived machine and table check agree on every (state, event) pair', () => {
    expect(scenarios.length).toBeGreaterThan(0);
    const mismatches = scenarios.filter(({ state, move, limits }) =>
      disagree(
        evaluate__SINGULAR_PASCAL__Move(state, move, limits),
        canApply__SINGULAR_PASCAL__Move(state, move, limits),
      ),
    );
    expect(mismatches).toEqual([]);
  });

  it('exercises every rejection rule and at least one allowance (non-vacuity)', () => {
    const seenRules = new Set<RuleId>();
    let allowed = 0;
    for (const { state, move, limits } of scenarios) {
      const verdict = canApply__SINGULAR_PASCAL__Move(state, move, limits);
      if (verdict.allowed) allowed += 1;
      else seenRules.add(verdict.rule);
    }
    const required: readonly RuleId[] = ['unknown-item', 'done-requires-active', 'wip-limit'];
    for (const rule of required) expect(seenRules.has(rule)).toBe(true);
    expect(allowed).toBeGreaterThan(0);
  });

  it('is not vacuous: a hand-written machine that DROPS a guard is caught by `disagree`', () => {
    // The planted mutant (proves the drift-proof has teeth). A deliberately
    // DRIFTED, hand-written oracle: it still honours the wip-limit guard but
    // FORGETS `done-requires-active`, so it wrongly allows any item to jump
    // straight to `done`. If the enumeration + `disagree` above were vacuous
    // this bug would slip through unnoticed; instead they MUST flag at least one
    // scenario against the real table walk. Kept INLINE and self-contained — a
    // drifted copy of `canApply` with one guard removed.
    const driftedMachine = (
      state: __SINGULAR_PASCAL__State,
      move: __SINGULAR_PASCAL__Move,
      limits: WipLimits,
    ): __SINGULAR_PASCAL__Verdict => {
      const item = state.items.find((candidate) => candidate.id === move.itemId);
      if (item === undefined) return { allowed: false, rule: 'unknown-item' };
      if (item.phase === move.to) return { allowed: true };
      // BUG (planted): only the wip-limit guard survives — the ordering guard
      // `done-requires-active` is dropped, so `done` is reachable from anywhere.
      const limit = limits[move.to];
      if (limit !== undefined) {
        const occupants = state.items.filter((i) => i.phase === move.to && i.id !== item.id).length;
        if (occupants >= limit) return { allowed: false, rule: 'wip-limit' };
      }
      return { allowed: true };
    };
    const caught = scenarios.some(({ state, move, limits }) =>
      disagree(driftedMachine(state, move, limits), canApply__SINGULAR_PASCAL__Move(state, move, limits)),
    );
    expect(caught).toBe(true);
  });
});
