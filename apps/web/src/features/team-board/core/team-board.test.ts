import { describe, expect, it } from 'vitest';

import { type Card } from '#core/domain/index.js';

import { createTeamBoardCore } from './index.js';
import {
  columnsOf,
  effectiveBoard,
  occupancyOf,
  pendingIds,
  verdictOf,
  wipLimitOf,
} from './selectors.js';
import {
  createTeamBoardStore,
  type GatewayResult,
  type TeamBoardGateway,
} from './store.js';

/**
 * Core seam test — exercises the team-board island core WITHOUT rendering (no
 * React, plain node), so TUI portability is proven on every `check`. The store is
 * pure over its injected gateway; the selectors merge the store's overlay onto a
 * fixed server list. The rung-3 twist over the personal board: a move is REQUESTED,
 * and the store consults the domain oracle before dispatching — a blocked move
 * never becomes a pending op and never reaches the gateway.
 */

const card = (id: string, title: string, column: string, visited: readonly string[]): Card => ({
  id,
  tenantId: 't1',
  title,
  board: 'team',
  column,
  position: 0,
  visited: [...visited],
  createdAt: '2026-07-19T00:00:00.000Z',
});

// Alpha in in-dev (has passed through in-dev); Beta in todo (has not).
const serverCards: readonly Card[] = [
  card('a', 'Alpha', 'in-dev', ['todo', 'in-dev']),
  card('b', 'Beta', 'todo', ['todo']),
];

interface SpyGateway extends TeamBoardGateway {
  readonly addCalls: { title: string; column: string }[];
  readonly moveCalls: { cardId: string; toColumn: string; toIndex: number }[];
}

const spyGateway = (ok: boolean): SpyGateway => {
  const result: GatewayResult = ok ? { ok: true } : { ok: false, error: 'stub failure' };
  const addCalls: { title: string; column: string }[] = [];
  const moveCalls: { cardId: string; toColumn: string; toIndex: number }[] = [];
  return {
    addCalls,
    moveCalls,
    addCard: (input) => {
      addCalls.push({ ...input });
      return Promise.resolve(result);
    },
    moveCard: (input) => {
      moveCalls.push({ ...input });
      return Promise.resolve(result);
    },
  };
};

const counter = (): (() => string) => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const titles = (cards: readonly { title: string }[]): string[] => cards.map((entry) => entry.title);

describe('team board store — optimistic apply', () => {
  it('lays an allowed move onto the board before the gateway settles', () => {
    const gateway = spyGateway(true);
    const store = createTeamBoardStore({ gateway, generateId: counter() });

    store.send({
      type: 'cardMoveRequested',
      cardId: 'a',
      fromColumn: 'in-dev',
      toColumn: 'review',
      board: serverCards,
    });

    const board = effectiveBoard(store.getState(), serverCards);
    const grouped = columnsOf(board, pendingIds(store.getState()));
    expect(titles(grouped.review)).toEqual(['Alpha']);
    expect(titles(grouped['in-dev'])).toEqual([]);
    expect(grouped.review[0]?.pending).toBe(true);
    expect(gateway.moveCalls).toEqual([{ cardId: 'a', toColumn: 'review', toIndex: 0 }]);
    expect(store.getState().lastRejection).toBeNull();
  });

  it('lays an in-flight add at the end of its column', () => {
    const gateway = spyGateway(true);
    const store = createTeamBoardStore({ gateway, generateId: counter() });

    store.send({ type: 'cardAdded', title: 'Gamma', column: 'todo' });

    const grouped = columnsOf(effectiveBoard(store.getState(), serverCards), pendingIds(store.getState()));
    expect(titles(grouped.todo)).toEqual(['Beta', 'Gamma']);
    expect(grouped.todo[1]?.pending).toBe(true);
    expect(gateway.addCalls).toEqual([{ title: 'Gamma', column: 'todo' }]);
  });
});

describe('team board store — oracle gate', () => {
  it('refuses an illegal move: it never reaches the gateway and records the rule', () => {
    const gateway = spyGateway(true);
    const store = createTeamBoardStore({ gateway, generateId: counter() });
    const before = effectiveBoard(store.getState(), serverCards);

    // Beta has never visited in-dev, so review-requires-in-dev must block it.
    store.send({
      type: 'cardMoveRequested',
      cardId: 'b',
      fromColumn: 'todo',
      toColumn: 'review',
      board: serverCards,
    });

    expect(gateway.moveCalls).toEqual([]);
    expect(store.getState().pending).toEqual([]);
    expect(store.getState().lastRejection).toEqual({
      cardId: 'b',
      toColumn: 'review',
      rule: 'review-requires-in-dev',
    });
    expect(effectiveBoard(store.getState(), serverCards)).toEqual(before);
  });
});

describe('team board store — rollback', () => {
  it('restores the exact pre-op board when the gateway fails', async () => {
    const store = createTeamBoardStore({ gateway: spyGateway(false), generateId: counter() });
    const before = effectiveBoard(store.getState(), serverCards);

    store.send({
      type: 'cardMoveRequested',
      cardId: 'a',
      fromColumn: 'in-dev',
      toColumn: 'review',
      board: serverCards,
    });
    await flush();

    expect(effectiveBoard(store.getState(), serverCards)).toEqual(before);
    expect(store.getState().pending).toEqual([]);
  });
});

describe('team board island core — the public seam runs in plain node', () => {
  // The PUBLIC factory (features/team-board/index.web.ts binds this in the
  // browser): fed a fake gateway and fake descriptors, the whole seam — send in,
  // subscribe + selectors + oracle verdict out — runs with no api.ts, no React
  // and no DOM.
  const descriptors = {
    list: { queryKey: ['cards', 'list', 'team'] },
    invalidates: () => ({ queryKey: ['cards', 'list'] }),
  };

  it('gates a move through the oracle and reads the board back through selectors', () => {
    const gateway = spyGateway(true);
    const core = createTeamBoardCore({ gateway, descriptors, generateId: counter() });

    expect(core.teamBoardSelectors.list).toBe(descriptors.list);
    expect(core.teamBoardSelectors.columns).toEqual(['todo', 'in-dev', 'review', 'done']);

    // Beta (never visited in-dev) → review is blocked by the domain oracle; the
    // move never reaches the gateway and surfaces as lastRejection.
    core.send({
      type: 'cardMoveRequested',
      cardId: 'b',
      fromColumn: 'todo',
      toColumn: 'review',
      board: serverCards,
    });
    expect(gateway.moveCalls).toEqual([]);
    expect(core.teamBoardSelectors.lastRejection()).toEqual({
      cardId: 'b',
      toColumn: 'review',
      rule: 'review-requires-in-dev',
    });

    // Alpha (has visited in-dev) → review is allowed and lands optimistically.
    core.send({
      type: 'cardMoveRequested',
      cardId: 'a',
      fromColumn: 'in-dev',
      toColumn: 'review',
      board: serverCards,
    });
    const grouped = core.teamBoardSelectors.grouped(core.teamBoardSelectors.board(serverCards));
    expect(titles(grouped.review)).toEqual(['Alpha']);
    expect(gateway.moveCalls).toEqual([{ cardId: 'a', toColumn: 'review', toIndex: 0 }]);
  });
});

describe('team board selectors — WIP and verdicts', () => {
  it('reports each bounded column occupancy and limit', () => {
    // review is full at its limit of 2.
    const full: readonly Card[] = [
      card('r1', 'R1', 'review', ['todo', 'in-dev', 'review']),
      card('r2', 'R2', 'review', ['todo', 'in-dev', 'review']),
      card('d', 'Delta', 'in-dev', ['todo', 'in-dev']),
    ];
    expect(occupancyOf(full, 'review')).toBe(2);
    expect(wipLimitOf('review')).toBe(2);
    expect(wipLimitOf('todo')).toBeUndefined();

    // Delta has visited in-dev, but review is full → blocked by wip-limit.
    const verdict = verdictOf(full, 'd', 'review');
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed ? undefined : verdict.rule).toBe('wip-limit');
  });

  it('allows a legal move and names the rule for an illegal one', () => {
    expect(verdictOf(serverCards, 'a', 'review').allowed).toBe(true);
    const blocked = verdictOf(serverCards, 'b', 'review');
    expect(blocked.allowed ? undefined : blocked.rule).toBe('review-requires-in-dev');
    const notDone = verdictOf(serverCards, 'a', 'done');
    expect(notDone.allowed ? undefined : notDone.rule).toBe('done-only-from-review');
  });
});
