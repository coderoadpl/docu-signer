import { describe, expect, it } from 'vitest';

import { type Card } from '#core/domain/index.js';

import { createBoardCore } from './index.js';
import { boardOf, canUndoOf } from './selectors.js';
import {
  createBoardStore,
  type BoardGateway,
  type GatewayResult,
} from './store.js';

/**
 * Core seam test — exercises the board island core WITHOUT rendering (no React,
 * plain node), so TUI portability is proven on every `check`. The store is pure
 * over its injected gateway: a test drives it with an in-memory fake, and the
 * selectors merge the store's overlay onto a fixed server list.
 */

const card = (id: string, title: string, column: string, position: number): Card => ({
  id,
  tenantId: 't1',
  title,
  board: 'personal',
  column,
  position,
  visited: [column],
  createdAt: '2026-07-11T00:00:00.000Z',
});

// Alpha, Beta in todo; Gamma in doing.
const serverCards: readonly Card[] = [
  card('a', 'Alpha', 'todo', 0),
  card('b', 'Beta', 'todo', 1),
  card('c', 'Gamma', 'doing', 0),
];

interface SpyGateway extends BoardGateway {
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

const ids = (cards: readonly { id: string }[]): string[] => cards.map((entry) => entry.id);

describe('board store — optimistic apply', () => {
  it('lays an in-flight move onto the cache before the gateway settles', () => {
    const store = createBoardStore({ gateway: spyGateway(true), generateId: counter() });
    store.send({
      type: 'cardMoved',
      cardId: 'a',
      fromColumn: 'todo',
      fromIndex: 0,
      toColumn: 'doing',
      toIndex: 0,
      toColumnSize: 1,
    });

    const board = boardOf(store.getState(), serverCards);
    expect(ids(board.doing)).toEqual(['a', 'c']);
    expect(ids(board.todo)).toEqual(['b']);
    expect(board.doing[0]?.pending).toBe(true);
  });

  it('lays an in-flight add at the end of its column', () => {
    const store = createBoardStore({ gateway: spyGateway(true), generateId: counter() });
    store.send({ type: 'cardAdded', title: 'Delta', column: 'doing' });

    const board = boardOf(store.getState(), serverCards);
    expect(board.doing.map((entry) => entry.title)).toEqual(['Gamma', 'Delta']);
    expect(board.doing[1]?.pending).toBe(true);
  });
});

describe('board store — rollback', () => {
  it('restores the exact pre-op board when the gateway fails', async () => {
    const store = createBoardStore({ gateway: spyGateway(false), generateId: counter() });
    const before = boardOf(store.getState(), serverCards);

    store.send({
      type: 'cardMoved',
      cardId: 'a',
      fromColumn: 'todo',
      fromIndex: 0,
      toColumn: 'doing',
      toIndex: 0,
      toColumnSize: 1,
    });
    await flush();

    expect(boardOf(store.getState(), serverCards)).toEqual(before);
    expect(canUndoOf(store.getState())).toBe(false);
  });
});

describe('board store — undo', () => {
  it('records an inverse move on commit and replays it on undo', async () => {
    const gateway = spyGateway(true);
    const store = createBoardStore({ gateway, generateId: counter() });

    store.send({
      type: 'cardMoved',
      cardId: 'a',
      fromColumn: 'todo',
      fromIndex: 0,
      toColumn: 'doing',
      toIndex: 0,
      toColumnSize: 1,
    });
    await flush();
    expect(canUndoOf(store.getState())).toBe(true);

    // The server list now reflects the committed move (a is in doing).
    const moved: readonly Card[] = [
      card('a', 'Alpha', 'doing', 0),
      card('c', 'Gamma', 'doing', 1),
      card('b', 'Beta', 'todo', 0),
    ];

    store.send({ type: 'undoRequested' });
    const board = boardOf(store.getState(), moved);
    expect(ids(board.todo)).toEqual(['a', 'b']);

    await flush();
    expect(gateway.moveCalls).toContainEqual({ cardId: 'a', toColumn: 'todo', toIndex: 0 });
    expect(canUndoOf(store.getState())).toBe(false);
  });
});

describe('board island core — the public seam runs in plain node', () => {
  // The PUBLIC factory (features/board/index.web.ts binds this in the browser):
  // fed a fake gateway and fake descriptors, the whole seam — send in,
  // subscribe + selectors out — runs with no api.ts, no React and no DOM.
  const descriptors = {
    list: { queryKey: ['cards', 'list', 'personal'] },
    invalidates: () => ({ queryKey: ['cards', 'list'] }),
  };

  it('passes the injected descriptors straight through the selectors', () => {
    const core = createBoardCore({
      gateway: spyGateway(true),
      descriptors,
      generateId: counter(),
    });
    expect(core.boardSelectors.list).toBe(descriptors.list);
    expect(core.boardSelectors.invalidates).toBe(descriptors.invalidates);
    expect(core.boardSelectors.columns).toEqual(['todo', 'doing', 'done']);
  });

  it('applies an event through send and reads it back through the selectors', () => {
    const core = createBoardCore({
      gateway: spyGateway(true),
      descriptors,
      generateId: counter(),
    });

    let notified = 0;
    const unsubscribe = core.subscribe(() => {
      notified += 1;
    });

    core.send({ type: 'cardAdded', title: 'Delta', column: 'doing' });

    const board = core.boardSelectors.board(serverCards);
    expect(board.doing.map((entry) => entry.title)).toEqual(['Gamma', 'Delta']);
    expect(board.doing[1]?.pending).toBe(true);
    expect(core.boardSelectors.canUndo()).toBe(false);
    expect(notified).toBeGreaterThan(0);

    unsubscribe();
  });
});

describe('board store — clamp', () => {
  it('clamps toIndex into [0, destination size] before the gateway', async () => {
    const gateway = spyGateway(true);
    const store = createBoardStore({ gateway, generateId: counter() });

    store.send({
      type: 'cardMoved',
      cardId: 'a',
      fromColumn: 'todo',
      fromIndex: 0,
      toColumn: 'doing',
      toIndex: 999,
      toColumnSize: 1,
    });
    expect(ids(boardOf(store.getState(), serverCards).doing)).toEqual(['c', 'a']);

    await flush();
    expect(gateway.moveCalls[0]).toEqual({ cardId: 'a', toColumn: 'doing', toIndex: 1 });
  });
});
