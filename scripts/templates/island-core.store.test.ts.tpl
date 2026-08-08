import { describe, expect, it } from 'vitest';

import { create__SINGULAR_PASCAL__Core } from './index.js';
import {
  canUndoOf,
  create__SINGULAR_PASCAL__Store,
  __SINGULAR_CAMEL__ItemsOf,
  type GatewayResult,
  type __SINGULAR_PASCAL__Gateway,
} from './store.js';

/**
 * Core seam test — exercises the __SINGULAR_KEBAB__ island core WITHOUT rendering
 * (no React, plain node). RUNG 2 (island store): the seam block drives the PUBLIC
 * factory with a FAKE gateway and a FAKE descriptor — no api.ts, no network, no
 * DOM — proving the whole seam (send in, selectors out) runs in plain node. The
 * store block drives the store directly with the same fake gateway.
 */

// A fake gateway: the store is pure over its injected deps, so a test drives it
// with an in-memory gateway — no network. Pass `ok: false` to exercise rollback.
const stubGateway = (ok: boolean): __SINGULAR_PASCAL__Gateway => {
  const result: GatewayResult = ok ? { ok: true } : { ok: false, error: 'stub failure' };
  return {
    addItem: () => Promise.resolve(result),
    moveItem: () => Promise.resolve(result),
    removeItem: () => Promise.resolve(result),
  };
};

const fakeDescriptors = { list: { queryKey: ['__SINGULAR_KEBAB__'] } };

// Flush the store's async gateway effect (an optimistic op settles on the next
// macrotask) so an assertion can observe the committed state.
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('__SINGULAR_KEBAB__ island core seam', () => {
  it('exposes its read seam as selectors (the injected descriptor threads through)', () => {
    const core = create__SINGULAR_PASCAL__Core({
      gateway: stubGateway(true),
      descriptors: fakeDescriptors,
      generateId: () => 'id-1',
    });
    expect(core.__SINGULAR_CAMEL__Selectors.list).toBe(fakeDescriptors.list);
  });

  it('applies an event through send and merges it over the server list', () => {
    const core = create__SINGULAR_PASCAL__Core({
      gateway: stubGateway(true),
      descriptors: fakeDescriptors,
      generateId: () => 'id-1',
    });
    core.send({ type: 'itemAddRequested', title: 'typed' });
    const merged = core.__SINGULAR_CAMEL__Selectors.items([{ id: 's1', title: 'from server' }]);
    expect(merged.map((item) => item.title)).toEqual(['from server', 'typed']);
    expect(merged.find((item) => item.title === 'typed')?.pending).toBe(true);
  });
});

describe('__SINGULAR_PASCAL__ store (rung 2) — overlay only', () => {
  it('lays an optimistic add over the server list without copying it', () => {
    const store = create__SINGULAR_PASCAL__Store({
      gateway: stubGateway(true),
      generateId: () => 'id-1',
    });
    store.send({ type: 'itemAddRequested', title: 'typed' });
    // The store holds only the pending op; the list truth is passed in at merge.
    const merged = __SINGULAR_CAMEL__ItemsOf(store.getState(), [{ id: 's1', title: 'from server' }]);
    expect(merged.map((item) => item.title)).toEqual(['from server', 'typed']);
    expect(merged.find((item) => item.title === 'typed')?.pending).toBe(true);
  });

  it('drops the pending op and bumps committedRev once the add commits', async () => {
    const store = create__SINGULAR_PASCAL__Store({
      gateway: stubGateway(true),
      generateId: () => 'id-1',
    });
    store.send({ type: 'itemAddRequested', title: 'typed' });
    expect(store.getState().pending).toHaveLength(1);
    expect(store.getState().committedRev).toBe(0);
    await flush();
    expect(store.getState().pending).toHaveLength(0);
    expect(store.getState().committedRev).toBe(1);
  });

  it('offers undo once a move commits', async () => {
    const store = create__SINGULAR_PASCAL__Store({
      gateway: stubGateway(true),
      generateId: () => 'id-1',
    });
    expect(canUndoOf(store.getState())).toBe(false);
    store.send({ type: 'itemMoveRequested', itemId: 's1', fromIndex: 0, toIndex: 2, listSize: 3 });
    await flush();
    expect(canUndoOf(store.getState())).toBe(true);
  });

  // <<EXTENSION POINT — store tests>>
  // Assert rollback: with `stubGateway(false)`, a pending op is dropped after
  // `flush()` and `__SINGULAR_CAMEL__ItemsOf` reads back the untouched server list.
  // Assert undo replays the inverse gateway move. Drive the store directly here;
  // never render to test it.
});
